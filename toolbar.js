// ==UserScript==
// @name         osu! Modding TB
// @namespace    https://github.com/bei-osu/toolbar
// @version      2025.11.03
// @description  Have Fun I Guess
// @author       Bei
// @match        https://osu.ppy.sh/beatmapsets/*/discussion*
// @match        https://osu.ppy.sh/beatmapsets/*/discussion/*
// @grant        GM_xmlhttpRequest
// @connect      api.datamuse.com
// @connect      api.dictionaryapi.dev
// @connect      api.languagetool.org/v2/check
// @connect      osu.ppy.sh
// @connect      *
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// ==/UserScript==

let TBInstance;
(function() {
	'use strict';
	
	// CONFIGURATION
	const SCRIPT_ID = 'osu!-Modding-TB';
	if (window[SCRIPT_ID]) {
		console.log('osu! TB already loaded, skipping...');
		return;
	}
	window[SCRIPT_ID] = true;
	const CONFIG = {
		STORAGE_KEY: 'osuTBSettings',
		TEMPLATES_KEY: 'osu-templates',
		KEYBINDS_KEY: 'osu-keybinds',
		DEFAULT_WIDTH: 120,
		DEFAULT_HEIGHT: 400,
		MIN_WIDTH: 80,
		MIN_HEIGHT: 100,
		MAX_BUTTONS_PER_ROW: 4,
		DEBOUNCE_DELAY: 300,
		DEBUG: false
	};
	const debug = {
		log: () => {},
		warn: () => {},
		error: console.error.bind(console, '[osu! TB]')
	};
	// NOTE PREVIEW CONFIGURATION
	const NOTE_PREVIEW_CONFIG = {
		canvasWidth: 360,
		canvasHeight: 500,
		defaultCols: 4,
		hoverDelayMs: 120,
		offsetX: 14,
		offsetY: 14,
		fadeMs: 160,
		enabled: localStorage.getItem('maniaPreview_disabled') !== 'true',
		snapColors: {
			'1/1': '#ff3333',
			'1/2': '#3366ff',
			'1/3': '#cc33ff',
			'1/4': '#ffff33',
			'1/6': '#ff66cc',
			'1/8': '#33ffff',
			'1/12': '#cccccc',
			'1/16': '#66ff66',
			default: '#ffffff'
		}
	};
	const BEATMAP_NOTES_CONFIG = {
		STORAGE_KEY: 'osu-beatmap-notes',
		enabled: localStorage.getItem('beatmapNotes_disabled') !== 'true'
	};
	const BROWSER_CONFIG = {
		enabled: localStorage.getItem('browser_disabled') !== 'true',
		defaultWidth: 600,
		defaultHeight: 500
	};
	const BOOKMARKS_CONFIG = {
		STORAGE_KEY: 'osu-pattern-bookmarks',
		enabled: localStorage.getItem('bookmarks_disabled') !== 'true'
	};
	// UTILITIES
	const Utils = {
		debounce(func, wait) {
			let timeout;
			return function executedFunction(...args) {
				clearTimeout(timeout);
				timeout = setTimeout(() => func(...args), wait);
			};
		},
		throttle(func, limit) {
			let inThrottle;
			return function(...args) {
				if (!inThrottle) {
					func.apply(this, args);
					inThrottle = true;
					setTimeout(() => inThrottle = false, limit);
				}
			};
		},
		clamp(value, min, max) {
			return Math.min(Math.max(value, min), max);
		},
		createElement(tag, className, innerHTML) {
			const element = document.createElement(tag);
			if (className) element.className = className;
			if (innerHTML) element.innerHTML = innerHTML;
			return element;
		},
		sanitizeHTML(str) {
			const div = document.createElement('div');
			div.textContent = str;
			return div.innerHTML;
		},
		getOptimalPosition(element, reference, preferredSide = 'right') {
			const elementRect = {
				width: 320,
				height: 400
			};
			const referenceRect = reference ? reference.getBoundingClientRect() : null;
			const viewport = {
				width: window.innerWidth,
				height: window.innerHeight
			};
			let position = {
				x: 50,
				y: 100
			};
			if (referenceRect) {
				const spacing = 15;
				if (preferredSide === 'right') {
					position.x = referenceRect.right + spacing;
					if (position.x + elementRect.width > viewport.width) {
						position.x = Math.max(spacing, referenceRect.left - elementRect.width - spacing);
					}
				} else {
					position.x = referenceRect.left - elementRect.width - spacing;
					if (position.x < 0) {
						position.x = referenceRect.right + spacing;
					}
				}
				position.y = Math.max(spacing, referenceRect.top);
				if (position.y + elementRect.height > viewport.height) {
					position.y = Math.max(spacing, viewport.height - elementRect.height - spacing);
				}
			}
			return position;
		}
	};
	// RC RULES AND BPM SCALING
	const RC_RULES = {
		Easy: {
			density: "mostly 1/1, occasional 1/2, or slower rhythms",
			consecutive: {
				snap: "1/4",
				limit: 5
			},
			snapping: "1/4 and higher should not be used",
			longNoteMin: "1 beat",
			longNoteGap: "1 beat",
			anchors: null,
			hp: 7,
			od: 7
		},
		Normal: {
			density: "mostly 1/1 and 1/2, occasional 1/4, or slower rhythms",
			consecutive: {
				snap: "1/4",
				limit: 5
			},
			snapping: "1/6 and above should not be used",
			longNoteMin: "1/2 beat",
			longNoteGap: "1/2 beat",
			anchors: 3,
			hp: 7.5,
			od: 7.5
		},
		Hard: {
			density: null,
			consecutive: null,
			snapping: "consecutive 1/8 and higher should not be used",
			longNoteMin: "1/4 beat",
			longNoteGap: null,
			anchors: 5,
			hp: 8,
			od: 8,
			trillLimit: 9
		},
		Insane: {
			density: null,
			consecutive: null,
			snapping: null,
			longNoteMin: null,
			longNoteGap: null,
			anchors: null,
			hp: null,
			od: null,
			splitJumptrillLimit: 9
		},
		Expert: {
			density: null,
			consecutive: null,
			snapping: null,
			longNoteMin: null,
			longNoteGap: null,
			anchors: null,
			hp: null,
			od: null
		}
	};
	class BPMScaler {
		static scaleDensityRule(bpm, baseDensity) {
			if (!baseDensity) return null;
			if (bpm <= 75) return "mostly 1/1, very frequent 1/2, common 1/4";
			if (bpm <= 90) return "mostly 1/1, frequent 1/2, occasional 1/4";
			if (bpm <= 120) return "mostly 1/2, frequent 1/4, occasional 1/1";
			if (bpm >= 330) return "almost entirely 1/1, very rare 1/2";
			if (bpm >= 300) return "mostly 1/1, rare 1/2";
			if (bpm >= 270) return "mostly 1/1, occasional 1/2";
			if (bpm >= 240) return "balanced 1/1 and 1/2";
			return baseDensity;
		}
		static scaleConsecutiveLimit(bpm, baseLimit) {
			if (!baseLimit) return null;
			if (bpm <= 60) return Math.floor(baseLimit * 3);
			if (bpm <= 75) return Math.floor(baseLimit * 2.5);
			if (bpm <= 90) return Math.floor(baseLimit * 2);
			if (bpm <= 120) return Math.floor(baseLimit * 1.5);
			if (bpm >= 360) return Math.max(1, Math.floor(baseLimit * 0.3));
			if (bpm >= 330) return Math.max(1, Math.floor(baseLimit * 0.4));
			if (bpm >= 300) return Math.max(1, Math.floor(baseLimit * 0.5));
			if (bpm >= 270) return Math.max(2, Math.floor(baseLimit * 0.7));
			if (bpm >= 240) return Math.max(2, Math.floor(baseLimit * 0.8));
			return baseLimit;
		}
		static scaleAnchorLimit(bpm, baseLimit) {
			if (!baseLimit) return null;
			if (bpm <= 90) return baseLimit + 3;
			if (bpm <= 120) return baseLimit + 2;
			if (bpm >= 330) return Math.max(3, baseLimit - 3);
			if (bpm >= 300) return Math.max(3, baseLimit - 2);
			if (bpm >= 240) return Math.max(3, baseLimit - 1);
			return baseLimit;
		}
		static scaleRules(difficulty, bpm) {
			const base = RC_RULES[difficulty];
			if (!base) return null;
			return {
				...base,
				density: this.scaleDensityRule(bpm, base.density),
				consecutive: base.consecutive ? {
					...base.consecutive,
					limit: this.scaleConsecutiveLimit(bpm, base.consecutive.limit)
				} : null,
				anchors: this.scaleAnchorLimit(bpm, base.anchors),
				bpm: bpm,
				scalingApplied: bpm < 120 || bpm > 240 // Flag for display
			};
		}
	}
	// STATE MANAGEMENT
	class TBState {
		constructor() {
			this.keyboardShortcuts = false;
			this.position = {
				x: window.innerWidth - 140,
				y: window.innerHeight / 2 - 200
			};
			this.size = {
				width: CONFIG.DEFAULT_WIDTH,
				height: CONFIG.DEFAULT_HEIGHT
			};
			this.previewPosition = null;
			this.beatmapNotesPosition = null;
		}
		load() {
			try {
				const data = localStorage.getItem(CONFIG.STORAGE_KEY);
				if (data) {
					const parsed = JSON.parse(data);
					Object.assign(this, parsed);
					debug.log('Settings loaded');
				}
			} catch (error) {
				debug.warn('Failed to load settings:', error);
			}
		}
		save() {
			try {
				const data = {
					keyboardShortcuts: this.keyboardShortcuts,
					position: this.position,
					size: this.size,
					previewPosition: this.previewPosition,
					beatmapNotesPosition: this.beatmapNotesPosition
				};
				localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data));
			} catch (error) {
				debug.warn('Failed to save settings:', error);
			}
		}
	}
	// TEXT EDITOR
	class TextEditor {
		static findActiveTextarea() {
			if (!location.pathname.includes('/discussion')) return null;
			const focused = document.activeElement;
			if (focused && focused.tagName === 'TEXTAREA' &&
				focused.offsetParent !== null &&
				!focused.disabled && !focused.readOnly) {
				return focused;
			}
			const replySelectors = [
				'.beatmapset-discussion-post--reply textarea',
				'.beatmap-discussion-reply textarea',
				'.beatmapset-discussion__reply textarea',
				'div[class*="reply"][class*="expanded"] textarea',
				'div[class*="reply"]:not([style*="display: none"]) textarea',
			];
			for (const selector of replySelectors) {
				const elements = document.querySelectorAll(selector);
				for (const element of elements) {
					if (element.offsetParent !== null && !element.disabled && !element.readOnly) {
						return element;
					}
				}
			}
			const newDiscussionSelectors = [
				'.beatmap-discussion-new__message-area textarea',
				'.beatmapset-discussion-textarea',
				'.js-beatmapset-discussion-new textarea',
				'.beatmapset-discussion-new textarea',
				'textarea[placeholder*="Timeline"]',
				'textarea[placeholder*="discussion"]',
			];
			for (const selector of newDiscussionSelectors) {
				const elements = document.querySelectorAll(selector);
				for (const element of elements) {
					if (element.offsetParent !== null && !element.disabled && !element.readOnly) {
						return element;
					}
				}
			}
			const allTextareas = document.querySelectorAll('textarea');
			for (const textarea of allTextareas) {
				if (textarea.offsetParent !== null &&
					!textarea.disabled &&
					!textarea.readOnly &&
					textarea.clientHeight > 0) {
					return textarea;
				}
			}
			return null;
		}
		static insertTextAtCursor(textarea, text) {
			if (!textarea) return false;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const currentText = textarea.value;
			textarea.value = currentText.substring(0, start) + text + currentText.substring(end);
			textarea.selectionStart = textarea.selectionEnd = start + text.length;
			textarea.focus();
			textarea.dispatchEvent(new Event('input', {
				bubbles: true
			}));
			return true;
		}
		static wrapSelectedText(textarea, before, after = '') {
			if (!textarea) return false;
			const start = textarea.selectionStart;
			const end = textarea.selectionEnd;
			const selectedText = textarea.value.substring(start, end);
			const replacement = before + selectedText + (after || before);
			textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
			textarea.selectionStart = start + before.length;
			textarea.selectionEnd = start + before.length + selectedText.length;
			textarea.focus();
			textarea.dispatchEvent(new Event('input', {
				bubbles: true
			}));
			return true;
		}
		static cleanupFormatting(text) {
			return text
				.replace(/ +/g, ' ')
				.replace(/ \*\*/g, '**')
				.replace(/\*\* /g, '**')
				.replace(/ \*/g, '*')
				.replace(/\* /g, '*')
				.replace(/ `/g, '`')
				.replace(/` /g, '`')
				.replace(/ ~~/g, '~~')
				.replace(/~~ /g, '~~')
				.replace(/\n\n\n+/g, '\n\n')
				.replace(/^[ ]*-[ ]*/gm, '- ')
				.replace(/^[ ]*\d+\.[ ]*/gm, (match) => match.replace(/[ ]+/g, ' '))
				.replace(/[ ]+$/gm, '')
				.trim();
		}
	}
	// TEMPLATE MANAGER
	class TemplateManager {
		static getTemplates() {
			try {
				return JSON.parse(localStorage.getItem(CONFIG.TEMPLATES_KEY) || '[]');
			} catch {
				return [];
			}
		}
		static saveTemplates(templates) {
			try {
				localStorage.setItem(CONFIG.TEMPLATES_KEY, JSON.stringify(templates));
				return true;
			} catch {
				return false;
			}
		}
		static addTemplate(text) {
			if (!text || !text.trim()) return false;
			const templates = this.getTemplates();
			const template = {
				id: Date.now(),
				text: text.trim(),
				preview: text.trim()
					.substring(0, 60) + (text.length > 60 ? '...' : ''),
				created: new Date()
					.toISOString()
			};
			templates.unshift(template);
			return this.saveTemplates(templates);
		}
		static deleteTemplate(id) {
			const templates = this.getTemplates();
			const filtered = templates.filter(t => t.id !== id);
			return this.saveTemplates(filtered);
		}
		static clearAll() {
			localStorage.removeItem(CONFIG.TEMPLATES_KEY);
			return true;
		}
	}
	// BEATMAP NOTES MANAGER
	class BeatmapNotesManager {
		static getCurrentBeatmapsetId() {
			const match = window.location.pathname.match(/\/beatmapsets\/(\d+)/);
			return match ? match[1] : null;
		}
		static getAllNotes() {
			try {
				return JSON.parse(localStorage.getItem(BEATMAP_NOTES_CONFIG.STORAGE_KEY) || '{}');
			} catch {
				return {};
			}
		}
		static getBeatmapNotes(beatmapsetId) {
			const allNotes = this.getAllNotes();
			return allNotes[beatmapsetId] || {
				content: '',
				updated: null
			};
		}
		static saveBeatmapNotes(beatmapsetId, content) {
			try {
				const allNotes = this.getAllNotes();
				allNotes[beatmapsetId] = {
					content: content.trim(),
					updated: new Date()
						.toISOString()
				};
				localStorage.setItem(BEATMAP_NOTES_CONFIG.STORAGE_KEY, JSON.stringify(allNotes));
				return true;
			} catch {
				return false;
			}
		}
		static deleteBeatmapNotes(beatmapsetId) {
			const allNotes = this.getAllNotes();
			delete allNotes[beatmapsetId];
			localStorage.setItem(BEATMAP_NOTES_CONFIG.STORAGE_KEY, JSON.stringify(allNotes));
		}
	}
	class ComparisonMode {
		static cache = new Map();
		static currentBeatmapId = null;
		static comparisonPanel = null;
		static async show() {
			const beatmapsetId = BeatmapNotesManager.getCurrentBeatmapsetId();
			if (!beatmapsetId) {
				UI.showNotification('No beatmapset detected', 'error');
				return;
			}
			UI.showNotification('Loading difficulties...', 'info');
			try {
				const difficulties = this.parseDifficultiesFromPage();
				if (difficulties.length < 2) {
					UI.showNotification('Need at least 2 difficulties to compare', 'warning');
					return;
				}
				this.showSelectionPanel(difficulties);
			} catch (error) {
				debug.error('Failed to load difficulties:', error);
				UI.showNotification('Failed to load difficulties', 'error');
			}
		}
		static parseDifficultiesFromPage() {
			const difficulties = [];
			const seen = new Set();
			const items = document.querySelectorAll('.beatmap-list__item[data-id]');
			items.forEach(el => {
				const beatmapId = el.getAttribute('data-id');
				if (!beatmapId || seen.has(beatmapId)) return;
				if (el.querySelector('.beatmap-list-item--deleted')) return;
				const versionLink = el.querySelector('.beatmap-list-item__version-link');
				const versionDiv = el.querySelector('.beatmap-list-item__version');
				let name = 'Unknown Difficulty';
				if (versionLink) {
					name = versionLink.textContent.trim();
				} else if (versionDiv) {
					name = versionDiv.textContent.trim();
				}
				name = name.replace(/\[deleted\]/gi, '')
					.replace(/guest difficulty by.*/i, '')
					.trim();
				seen.add(beatmapId);
				difficulties.push({
					id: beatmapId,
					name: name || `Difficulty ${beatmapId}`
				});
			});
			debug.log('Found difficulties:', difficulties);
			return difficulties;
		}
		static showSelectionPanel(difficulties) {
			let panel = document.getElementById('comparison-selection');
			if (panel) panel.remove();
			panel = Utils.createElement('div');
			panel.id = 'comparison-selection';
			panel.className = 'floating-panel';
			panel.style.cssText = 'width: 340px;';
			panel.innerHTML = `
            <button class="panel-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 1;">×</button>
            <div class="panel-content" style="padding-top: 20px;">
                <div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
                    <i class="fas fa-columns"></i> Select Difficulties to Compare
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; color: rgba(255,255,255,0.7); display: block; margin-bottom: 4px;">Difficulty 1:</label>
                    <select id="diff1-select" style="width: 100%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 6px; border-radius: 4px; font-size: 11px;">
                        ${difficulties.map(d => `<option value="${d.id}">${Utils.sanitizeHTML(d.name)}</option>`).join('')}
                    </select>
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; color: rgba(255,255,255,0.7); display: block; margin-bottom: 4px;">Difficulty 2:</label>
                    <select id="diff2-select" style="width: 100%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 6px; border-radius: 4px; font-size: 11px;">
                        ${difficulties.map((d, i) => `<option value="${d.id}" ${i === 1 ? 'selected' : ''}>${Utils.sanitizeHTML(d.name)}</option>`).join('')}
                    </select>
                </div>
                <div style="font-size: 10px; color: rgba(255,255,255,0.4); text-align: center; margin: 12px 0 8px 0; font-style: italic;">
                    Or upload .osu files:
                </div>
                <div style="margin-bottom: 8px;">
                    <label style="font-size: 11px; color: rgba(255,255,255,0.7); display: block; margin-bottom: 4px;">File 1:</label>
                    <input type="file" id="file1-input" accept=".osu" style="width: 100%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 4px; border-radius: 4px; font-size: 10px;">
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; color: rgba(255,255,255,0.7); display: block; margin-bottom: 4px;">File 2:</label>
                    <input type="file" id="file2-input" accept=".osu" style="width: 100%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 4px; border-radius: 4px; font-size: 10px;">
                </div>
                <button id="start-comparison" class="feature-btn" style="width: 100%; padding: 8px;">Start Comparison</button>
            </div>
        `;
			document.body.appendChild(panel);
			UI.makeDraggable(panel, panel);
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('click', () => panel.remove());
			closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
			const startBtn = panel.querySelector('#start-comparison');
			const file1Input = panel.querySelector('#file1-input');
			const file2Input = panel.querySelector('#file2-input');
			const diff1Select = panel.querySelector('#diff1-select');
			const diff2Select = panel.querySelector('#diff2-select');
			[startBtn, file1Input, file2Input, diff1Select, diff2Select].forEach(el => {
				if (el) el.addEventListener('mousedown', (e) => e.stopPropagation());
			});
			startBtn.addEventListener('click', async () => {
				let data1, data2;
				if (file1Input.files.length > 0 && file2Input.files.length > 0) {
					UI.showNotification('Loading files...', 'info');
					try {
						const file1Content = await file1Input.files[0].text();
						const file2Content = await file2Input.files[0].text();
						data1 = BeatmapParser.parseOsuContent(file1Content);
						data2 = BeatmapParser.parseOsuContent(file2Content);
						data1.version = file1Input.files[0].name.replace('.osu', '');
						data2.version = file2Input.files[0].name.replace('.osu', '');
						panel.remove();
						this.showComparisonView(data1, data2);
					} catch (error) {
						debug.error('Failed to load files:', error);
						UI.showNotification('Failed to load files', 'error');
					}
				} else if (file1Input.files.length > 0 || file2Input.files.length > 0) {
					UI.showNotification('Please upload both files or use dropdown', 'warning');
				} else {
					const id1 = diff1Select.value;
					const id2 = diff2Select.value;
					if (id1 === id2) {
						UI.showNotification('Select different difficulties', 'warning');
						return;
					}
					panel.remove();
					await this.startComparison(id1, id2, difficulties);
				}
			});
		}
		static async fetchBeatmapData(beatmapId) {
			if (this.cache.has(beatmapId)) {
				debug.log('Using cached data for', beatmapId);
				return this.cache.get(beatmapId);
			}
			try {
				const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const content = await response.text();
				const data = BeatmapParser.parseOsuContent(content);
				this.cache.set(beatmapId, data);
				setTimeout(() => this.cache.delete(beatmapId), 300000);
				return data;
			} catch (error) {
				debug.error('Failed to fetch beatmap:', beatmapId, error);
				throw error;
			}
		}
		static async startComparison(id1, id2, difficulties) {
			UI.showNotification('Loading beatmaps...', 'info');
			try {
				const [data1, data2] = await Promise.all([
					this.fetchBeatmapData(id1),
					this.fetchBeatmapData(id2)
				]);
				const diff1 = difficulties.find(d => d.id === id1);
				const diff2 = difficulties.find(d => d.id === id2);
				if (diff1) data1.version = diff1.name;
				if (diff2) data2.version = diff2.name;
				this.showComparisonView(data1, data2);
			} catch (error) {
				debug.error('Comparison failed:', error);
				UI.showNotification('Failed to load beatmaps', 'error');
			}
		}
		static showComparisonView(data1, data2) {
			if (this.comparisonPanel) {
				this.comparisonPanel.forEach(p => p?.close?.());
				this.comparisonPanel = null;
			}
			const player1 = this.createComparisonPlayer(data1, 'left');
			const player2 = this.createComparisonPlayer(data2, 'right');
			this.linkPlayers(player1, player2);
			this.comparisonPanel = [player1, player2];
			UI.showNotification('Comparison loaded - players linked', 'success');
		}
		static createComparisonPlayer(beatmapData, side) {
			const player = {
				beatmapData: beatmapData,
				currentTime: 0,
				isPlaying: false,
				startPlayTime: 0,
				animationFrame: null,
				playbackRate: 1.0,
				scrollSpeed: 1.5,
				noteHeight: 6,
				lnMinHeight: 20
			};
			player.panel = Utils.createElement('div');
			player.panel.className = 'comparison-player';
			player.panel.style.cssText = `
            position: fixed;
            width: 340px;
            height: 520px;
            background: rgba(12, 12, 12, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
            z-index: 10000;
            backdrop-filter: blur(10px);
        `;
			const savedPos = TBInstance?.state?.[`comparison_${side}_position`];
			if (savedPos) {
				player.panel.style.left = savedPos.x + 'px';
				player.panel.style.top = savedPos.y + 'px';
				player.panel.style.transform = 'none';
			} else {
				const centerX = window.innerWidth / 2;
				const spacing = 10;
				if (side === 'left') {
					player.panel.style.left = (centerX - 340 - spacing) + 'px';
				} else {
					player.panel.style.left = (centerX + spacing) + 'px';
				}
				player.panel.style.top = '50%';
				player.panel.style.transform = 'translateY(-50%)';
			}
			player.panel.innerHTML = `
            <button class="preview-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 10001;">×</button>
            <div style="position: relative;">
                <canvas class="preview-canvas" width="340" height="400" style="display: block; background: #000;"></canvas>
                <div class="density-scrollbar" style="position: absolute; top: 0; right: 0; width: 12px; height: 100%; background: rgba(0, 0, 0, 0.6); border-left: 1px solid rgba(255, 255, 255, 0.1);"></div>
                <div style="position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 9px; color: rgba(255, 255, 255, 0.3); pointer-events: none; text-align: center;">
                    Scroll: Wheel • Seek: Click
                </div>
            </div>
            <div style="padding: 5px 8px 5px 8px; background: rgba(20, 20, 20, 0.9); border-top: 1px solid rgba(255, 255, 255, 0.1);">
                <div style="margin-bottom: 8px;">
                    <div style="display: flex; gap: 4px; margin-bottom: 6px;">
                        <input type="text" class="timestamp-input" placeholder="mm:ss:ms" style="flex: 1; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-family: monospace;">
                        <button class="jump-btn" style="flex: 0 0 50px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 4px; border-radius: 4px; cursor: pointer; font-size: 10px;">Jump</button>
                    </div>
                </div>
                <div style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center;">
                    <button class="play-pause-btn" style="flex: 0 0 50px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 10px;">Play</button>
                    <button class="stop-btn" style="flex: 0 0 45px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 10px;">Stop</button>
                    <span class="time-display" style="font-size: 10px; color: rgba(255, 255, 255, 0.7); font-family: monospace; flex: 1; text-align: right;">0:00 / ${this.formatTimeSimple(this.getTotalDuration(player))}</span>
                </div>
                <div style="display: flex; gap: 6px; margin-bottom: 6px; align-items: flex-end;">
                    <div style="flex: 1;">
                        <label style="font-size: 8px; color: rgba(255, 255, 255, 0.5); display: block; margin-bottom: 1px;">Scroll</label>
                        <input type="range" class="scroll-speed-slider" min="0.5" max="3" step="0.1" value="1.5" style="width: 100%; height: 3px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; outline: none; -webkit-appearance: none; cursor: pointer;">
                        <div style="font-size: 8px; color: rgba(255, 255, 255, 0.4); text-align: center;" class="scroll-speed-display">1.5x</div>
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 8px; color: rgba(255, 255, 255, 0.5); display: block; margin-bottom: 1px;">Rate</label>
                        <select class="playback-rate" style="width: 100%; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; padding: 3px; border-radius: 4px; font-size: 9px;">
                            <option value="0.25">0.25x</option>
                            <option value="0.5">0.5x</option>
                            <option value="0.75">0.75x</option>
                            <option value="1" selected>1.0x</option>
                            <option value="1.25">1.25x</option>
                            <option value="1.5">1.5x</option>
                        </select>
                    </div>
                </div>
                <div style="font-size: 8px; color: rgba(255, 255, 255, 0.5); text-align: center; line-height: 1.2; padding: 2px 0;">
                    <div>${beatmapData.version}</div>
                    <div>${beatmapData.cs}K • ${beatmapData.bpm} BPM • ${beatmapData.notes.length} notes</div>
                </div>
            </div>
        `;
			document.body.appendChild(player.panel);
			player.canvas = player.panel.querySelector('.preview-canvas');
			player.ctx = player.canvas.getContext('2d');
			this.setupPlayerControls(player);
			this.drawPlayer(player);
			this.setupDensityScrollbar(player);
			const header = player.panel.querySelector('[style*="padding: 5px"]');
			header.style.cursor = 'move';
			UI.makeDraggable(player.panel, header, (position) => {
				if (TBInstance?.state) {
					TBInstance.state[`comparison_${side}_position`] = position;
					TBInstance.state.save();
				}
			});
			return player;
		}
		static setupDensityScrollbar(player) {
			const scrollbar = player.panel.querySelector('.density-scrollbar');
			if (!scrollbar) return;
			const calculateDensity = () => {
				if (!player.beatmapData) return [];
				const windowSize = 1000; // 1 second windows
				const totalDuration = this.getTotalDuration(player);
				const segments = [];
				for (let time = 0; time < totalDuration; time += windowSize) {
					const notesInWindow = player.beatmapData.notes.filter(n =>
							n.time >= time && n.time < time + windowSize
						)
						.length;
					segments.push({
						time,
						density: notesInWindow,
						y: (time / totalDuration) * 400
					});
				}
				return segments;
			};
			const renderDensityBars = () => {
				scrollbar.innerHTML = '';
				const totalDuration = this.getTotalDuration(player);
				const densitySegments = calculateDensity();
				const maxDensity = Math.max(...densitySegments.map(s => s.density), 1);
				densitySegments.forEach(segment => {
					const bar = document.createElement('div');
					bar.className = 'density-bar';
					bar.style.cssText = `
                    position: absolute;
                    left: 0;
                    width: 100%;
                    background: rgba(255, 255, 255, 0.3);
                    transition: background 0.2s ease;
                `;
					const intensity = segment.density / maxDensity;
					if (intensity > 0.7) {
						bar.style.background = 'rgba(255, 100, 100, 0.6)';
					} else if (intensity > 0.4) {
						bar.style.background = 'rgba(255, 200, 100, 0.5)';
					}
					bar.style.bottom = segment.y + 'px';
					bar.style.height = (400 / densitySegments.length) + 'px';
					bar.style.opacity = 0.3 + (intensity * 0.7);
					scrollbar.appendChild(bar);
				});
				const indicator = document.createElement('div');
				indicator.className = 'density-indicator';
				indicator.style.cssText = `
                position: absolute;
                left: 0;
                width: 100%;
                height: 3px;
                background: rgba(255, 255, 255, 0.9);
                box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
            `;
				scrollbar.appendChild(indicator);
				player.densityIndicator = indicator;
			};
			const updateIndicator = () => {
				if (!player.densityIndicator) return;
				const totalDuration = this.getTotalDuration(player);
				const progress = (player.currentTime / totalDuration) * 400;
				player.densityIndicator.style.bottom = progress + 'px';
			};
			renderDensityBars();
			player.updateDensityIndicator = updateIndicator;
			let isDragging = false;
			const seekToY = (clientY) => {
				const rect = scrollbar.getBoundingClientRect();
				const y = clientY - rect.top;
				const progress = 1 - (y / rect.height);
				const time = progress * this.getTotalDuration(player);
				player.currentTime = Math.max(0, Math.min(time, this.getTotalDuration(player)));
				if (player.isPlaying) {
					player.startPlayTime = Date.now() - player.currentTime;
				}
				this.drawPlayer(player);
			};
			scrollbar.addEventListener('mousedown', (e) => {
				e.stopPropagation();
				isDragging = true;
				seekToY(e.clientY);
			});
			document.addEventListener('mousemove', (e) => {
				if (isDragging) {
					seekToY(e.clientY);
				}
			});
			document.addEventListener('mouseup', () => {
				isDragging = false;
			});
		}
		static setupPlayerControls(player) {
			const closeBtn = player.panel.querySelector('.preview-close');
			closeBtn.addEventListener('click', () => {
				player.close();
			});
			closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
			const playBtn = player.panel.querySelector('.play-pause-btn');
			playBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (player.isPlaying) {
					this.pausePlayer(player);
				} else {
					this.playPlayer(player);
				}
			});
			const stopBtn = player.panel.querySelector('.stop-btn');
			stopBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.stopPlayer(player);
			});
			const timestampInput = player.panel.querySelector('.timestamp-input');
			const jumpBtn = player.panel.querySelector('.jump-btn');
			const parseTimestamp = (str) => {
				const parts = str.split(':');
				if (parts.length === 3) {
					const [mm, ss, ms] = parts.map(p => parseInt(p) || 0);
					return (mm * 60000) + (ss * 1000) + ms;
				} else if (parts.length === 2) {
					const [mm, ss] = parts.map(p => parseInt(p) || 0);
					return (mm * 60000) + (ss * 1000);
				}
				return parseInt(str) || 0;
			};
			const jump = () => {
				const time = parseTimestamp(timestampInput.value);
				if (time >= 0 && time <= this.getTotalDuration(player)) {
					this.seekPlayer(player, time);
					UI.showNotification(`Jumped to ${this.formatTimeSimple(time)}`, 'success');
					timestampInput.value = '';
				} else {
					UI.showNotification('Invalid timestamp', 'error');
				}
			};
			jumpBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				jump();
			});
			jumpBtn.addEventListener('mousedown', (e) => e.stopPropagation());
			timestampInput.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Enter') jump();
			});
			timestampInput.addEventListener('mousedown', (e) => e.stopPropagation());
			const scrollSpeedSlider = player.panel.querySelector('.scroll-speed-slider');
			const scrollSpeedDisplay = player.panel.querySelector('.scroll-speed-display');
			scrollSpeedSlider.addEventListener('input', (e) => {
				e.stopPropagation();
				player.scrollSpeed = parseFloat(e.target.value);
				scrollSpeedDisplay.textContent = `${player.scrollSpeed.toFixed(1)}x`;
				this.drawPlayer(player);
			});
			scrollSpeedSlider.addEventListener('mousedown', (e) => e.stopPropagation());
			const playbackRate = player.panel.querySelector('.playback-rate');
			playbackRate.addEventListener('change', (e) => {
				e.stopPropagation();
				player.playbackRate = parseFloat(e.target.value);
			});
			playbackRate.addEventListener('mousedown', (e) => e.stopPropagation());
			player.canvas.addEventListener('wheel', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const delta = e.deltaY;
				const scrollAmount = delta * 5;
				player.currentTime = Math.max(0, Math.min(
					player.currentTime + scrollAmount,
					this.getTotalDuration(player)
				));
				if (player.isPlaying) {
					player.startPlayTime = Date.now() - player.currentTime;
				}
				this.drawPlayer(player);
				const timeDisplay = player.panel.querySelector('.time-display');
				if (timeDisplay) {
					timeDisplay.textContent = `${this.formatTimeSimple(player.currentTime)} / ${this.formatTimeSimple(this.getTotalDuration(player))}`;
				}
			}, {
				passive: false
			});
			player.canvas.addEventListener('click', (e) => {
				e.stopPropagation();
				const rect = player.canvas.getBoundingClientRect();
				const y = e.clientY - rect.top;
				const progress = 1 - (y / player.canvas.height);
				const time = progress * this.getTotalDuration(player);
				this.seekPlayer(player, Math.max(0, Math.min(time, this.getTotalDuration(player))));
			});
			player.close = () => {
				this.pausePlayer(player);
				player.panel.remove();
			};
		}
		static playPlayer(player) {
			if (player.isPlaying) return;
			player.isPlaying = true;
			player.startPlayTime = Date.now() - player.currentTime;
			const playBtn = player.panel.querySelector('.play-pause-btn');
			if (playBtn) playBtn.textContent = 'Pause';
			this.updatePlayerPlayback(player);
		}
		static pausePlayer(player) {
			if (!player.isPlaying) return;
			player.isPlaying = false;
			if (player.animationFrame) {
				cancelAnimationFrame(player.animationFrame);
				player.animationFrame = null;
			}
			const playBtn = player.panel.querySelector('.play-pause-btn');
			if (playBtn) playBtn.textContent = 'Play';
		}
		static stopPlayer(player) {
			this.pausePlayer(player);
			player.currentTime = 0;
			player.startPlayTime = 0;
			const timeDisplay = player.panel.querySelector('.time-display');
			if (timeDisplay) timeDisplay.textContent = `0:00 / ${this.formatTimeSimple(this.getTotalDuration(player))}`;
			this.drawPlayer(player);
		}
		static seekPlayer(player, time) {
			player.currentTime = time;
			if (player.isPlaying) {
				player.startPlayTime = Date.now() - player.currentTime;
			}
			this.drawPlayer(player);
		}
		static updatePlayerPlayback(player) {
			if (!player.isPlaying) return;
			player.currentTime = (Date.now() - player.startPlayTime) * player.playbackRate;
			const totalDuration = this.getTotalDuration(player);
			if (player.currentTime >= totalDuration) {
				this.stopPlayer(player);
				return;
			}
			const timeDisplay = player.panel.querySelector('.time-display');
			if (timeDisplay) {
				timeDisplay.textContent = `${this.formatTimeSimple(player.currentTime)} / ${this.formatTimeSimple(totalDuration)}`;
			}
			this.drawPlayer(player);
			player.animationFrame = requestAnimationFrame(() => this.updatePlayerPlayback(player));
		}
		static drawPlayer(player) {
			if (!player.ctx || !player.beatmapData) return;
			const {
				width,
				height
			} = player.canvas;
			const cols = player.beatmapData.cs;
			const colWidth = width / cols;
			const hitPosition = height * 0.8;
			player.ctx.fillStyle = '#000';
			player.ctx.fillRect(0, 0, width, height);
			player.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
			player.ctx.lineWidth = 1;
			for (let i = 1; i < cols; i++) {
				player.ctx.beginPath();
				player.ctx.moveTo(i * colWidth, 0);
				player.ctx.lineTo(i * colWidth, height);
				player.ctx.stroke();
			}
			player.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
			player.ctx.lineWidth = 2;
			player.ctx.beginPath();
			player.ctx.moveTo(0, hitPosition);
			player.ctx.lineTo(width, hitPosition);
			player.ctx.stroke();
			player.beatmapData.notes.forEach(note => {
				const timeDiff = note.time - player.currentTime;
				const y = hitPosition - (timeDiff * player.scrollSpeed);
				if (note.isLN) {
					const endY = hitPosition - ((note.endTime - player.currentTime) * player.scrollSpeed);
					if (y < -200 && endY < -200 || y > height + 200 && endY > height + 200) return;
				} else {
					if (y < -50 || y > height + 50) return;
				}
				const x = note.col * colWidth;
				const noteWidth = colWidth - 4;
				if (note.isLN) {
					const endY = hitPosition - ((note.endTime - player.currentTime) * player.scrollSpeed);
					const lnHeight = Math.max(y - endY, player.lnMinHeight);
					player.ctx.fillStyle = 'rgba(255, 204, 0, 0.6)';
					player.ctx.fillRect(x + 2, endY, noteWidth, lnHeight);
					player.ctx.strokeStyle = 'rgba(255, 204, 0, 0.8)';
					player.ctx.lineWidth = 2;
					player.ctx.strokeRect(x + 2, endY, noteWidth, lnHeight);
					player.ctx.fillStyle = 'rgba(255, 204, 0, 1)';
					player.ctx.fillRect(x + 2, y - player.noteHeight, noteWidth, player.noteHeight * 2);
					player.ctx.fillRect(x + 2, endY - player.noteHeight, noteWidth, player.noteHeight * 2);
				} else {
					player.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
					player.ctx.fillRect(x + 2, y - player.noteHeight, noteWidth, player.noteHeight * 2);
					player.ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
					player.ctx.lineWidth = 1;
					player.ctx.strokeRect(x + 2, y - player.noteHeight, noteWidth, player.noteHeight * 2);
				}
			});
			player.beatmapData.notes.forEach(note => {
				if (note.isLN) {
					if (player.currentTime >= note.time && player.currentTime <= note.endTime) {
						const holdProgress = (player.currentTime - note.time) / (note.endTime - note.time);
						const alpha = 0.2 + (Math.sin(holdProgress * Math.PI * 4) * 0.1);
						player.ctx.fillStyle = `rgba(255, 204, 0, ${alpha})`;
						player.ctx.fillRect(note.col * colWidth, 0, colWidth, height);
					}
				} else {
					const timeDiff = Math.abs(note.time - player.currentTime);
					if (timeDiff < 50) {
						const alpha = 1 - (timeDiff / 50);
						player.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
						player.ctx.fillRect(note.col * colWidth, 0, colWidth, height);
					}
				}
			});
			if (player.updateDensityIndicator) {
				player.updateDensityIndicator();
			}
		}
		static getTotalDuration(player) {
			if (!player.beatmapData || player.beatmapData.notes.length === 0) return 0;
			const lastNote = player.beatmapData.notes[player.beatmapData.notes.length - 1];
			return lastNote.isLN ? lastNote.endTime : lastNote.time;
		}
		static formatTimeSimple(ms) {
			const minutes = Math.floor(ms / 60000);
			const seconds = Math.floor((ms % 60000) / 1000);
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
		static linkPlayers(player1, player2) {
			const syncState = {
				isSyncing: false
			};
			const playBtn1 = player1.panel.querySelector('.play-pause-btn');
			const playBtn2 = player2.panel.querySelector('.play-pause-btn');
			const newPlayBtn1 = playBtn1.cloneNode(true);
			const newPlayBtn2 = playBtn2.cloneNode(true);
			playBtn1.parentNode.replaceChild(newPlayBtn1, playBtn1);
			playBtn2.parentNode.replaceChild(newPlayBtn2, playBtn2);
			newPlayBtn1.addEventListener('click', (e) => {
				e.stopPropagation();
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				if (player1.isPlaying) {
					this.pausePlayer(player1);
					this.pausePlayer(player2);
				} else {
					this.playPlayer(player1);
					this.playPlayer(player2);
				}
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			newPlayBtn2.addEventListener('click', (e) => {
				e.stopPropagation();
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				if (player2.isPlaying) {
					this.pausePlayer(player1);
					this.pausePlayer(player2);
				} else {
					this.playPlayer(player1);
					this.playPlayer(player2);
				}
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			const stopBtn1 = player1.panel.querySelector('.stop-btn');
			const stopBtn2 = player2.panel.querySelector('.stop-btn');
			const newStopBtn1 = stopBtn1.cloneNode(true);
			const newStopBtn2 = stopBtn2.cloneNode(true);
			stopBtn1.parentNode.replaceChild(newStopBtn1, stopBtn1);
			stopBtn2.parentNode.replaceChild(newStopBtn2, stopBtn2);
			newStopBtn1.addEventListener('click', (e) => {
				e.stopPropagation();
				this.stopPlayer(player1);
				this.stopPlayer(player2);
			});
			newStopBtn2.addEventListener('click', (e) => {
				e.stopPropagation();
				this.stopPlayer(player1);
				this.stopPlayer(player2);
			});
			const canvas1 = player1.canvas;
			const canvas2 = player2.canvas;
			const newCanvas1 = canvas1.cloneNode(true);
			const newCanvas2 = canvas2.cloneNode(true);
			canvas1.parentNode.replaceChild(newCanvas1, canvas1);
			canvas2.parentNode.replaceChild(newCanvas2, canvas2);
			player1.canvas = newCanvas1;
			player2.canvas = newCanvas2;
			player1.ctx = newCanvas1.getContext('2d');
			player2.ctx = newCanvas2.getContext('2d');
			newCanvas1.style.cursor = 'crosshair';
			newCanvas2.style.cursor = 'crosshair';
			newCanvas1.addEventListener('click', (e) => {
				e.stopPropagation();
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const rect = newCanvas1.getBoundingClientRect();
				const y = e.clientY - rect.top;
				const progress = 1 - (y / newCanvas1.height);
				const time = progress * this.getTotalDuration(player1);
				const clampedTime = Math.max(0, Math.min(time, this.getTotalDuration(player1)));
				this.seekPlayer(player1, clampedTime);
				this.seekPlayer(player2, clampedTime);
				const timeDisplay1 = player1.panel.querySelector('.time-display');
				const timeDisplay2 = player2.panel.querySelector('.time-display');
				if (timeDisplay1) timeDisplay1.textContent = `${this.formatTimeSimple(clampedTime)} / ${this.formatTimeSimple(this.getTotalDuration(player1))}`;
				if (timeDisplay2) timeDisplay2.textContent = `${this.formatTimeSimple(clampedTime)} / ${this.formatTimeSimple(this.getTotalDuration(player2))}`;
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			newCanvas2.addEventListener('click', (e) => {
				e.stopPropagation();
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const rect = newCanvas2.getBoundingClientRect();
				const y = e.clientY - rect.top;
				const progress = 1 - (y / newCanvas2.height);
				const time = progress * this.getTotalDuration(player2);
				const clampedTime = Math.max(0, Math.min(time, this.getTotalDuration(player2)));
				this.seekPlayer(player1, clampedTime);
				this.seekPlayer(player2, clampedTime);
				const timeDisplay1 = player1.panel.querySelector('.time-display');
				const timeDisplay2 = player2.panel.querySelector('.time-display');
				if (timeDisplay1) timeDisplay1.textContent = `${this.formatTimeSimple(clampedTime)} / ${this.formatTimeSimple(this.getTotalDuration(player1))}`;
				if (timeDisplay2) timeDisplay2.textContent = `${this.formatTimeSimple(clampedTime)} / ${this.formatTimeSimple(this.getTotalDuration(player2))}`;
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			newCanvas1.addEventListener('wheel', (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const delta = e.deltaY;
				const scrollAmount = delta * 5;
				const newTime = Math.max(0, Math.min(
					player1.currentTime + scrollAmount,
					this.getTotalDuration(player1)
				));
				this.seekPlayer(player1, newTime);
				this.seekPlayer(player2, newTime);
				const timeDisplay1 = player1.panel.querySelector('.time-display');
				const timeDisplay2 = player2.panel.querySelector('.time-display');
				if (timeDisplay1) timeDisplay1.textContent = `${this.formatTimeSimple(newTime)} / ${this.formatTimeSimple(this.getTotalDuration(player1))}`;
				if (timeDisplay2) timeDisplay2.textContent = `${this.formatTimeSimple(newTime)} / ${this.formatTimeSimple(this.getTotalDuration(player2))}`;
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			}, {
				passive: false
			});
			newCanvas2.addEventListener('wheel', (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const delta = e.deltaY;
				const scrollAmount = delta * 5;
				const newTime = Math.max(0, Math.min(
					player2.currentTime + scrollAmount,
					this.getTotalDuration(player2)
				));
				this.seekPlayer(player1, newTime);
				this.seekPlayer(player2, newTime);
				const timeDisplay1 = player1.panel.querySelector('.time-display');
				const timeDisplay2 = player2.panel.querySelector('.time-display');
				if (timeDisplay1) timeDisplay1.textContent = `${this.formatTimeSimple(newTime)} / ${this.formatTimeSimple(this.getTotalDuration(player1))}`;
				if (timeDisplay2) timeDisplay2.textContent = `${this.formatTimeSimple(newTime)} / ${this.formatTimeSimple(this.getTotalDuration(player2))}`;
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			}, {
				passive: false
			});
			const jumpBtn1 = player1.panel.querySelector('.jump-btn');
			const jumpBtn2 = player2.panel.querySelector('.jump-btn');
			const timestampInput1 = player1.panel.querySelector('.timestamp-input');
			const timestampInput2 = player2.panel.querySelector('.timestamp-input');
			const parseTimestamp = (str) => {
				const parts = str.split(':');
				if (parts.length === 3) {
					const [mm, ss, ms] = parts.map(p => parseInt(p) || 0);
					return (mm * 60000) + (ss * 1000) + ms;
				} else if (parts.length === 2) {
					const [mm, ss] = parts.map(p => parseInt(p) || 0);
					return (mm * 60000) + (ss * 1000);
				}
				return parseInt(str) || 0;
			};
			const newJumpBtn1 = jumpBtn1.cloneNode(true);
			const newJumpBtn2 = jumpBtn2.cloneNode(true);
			jumpBtn1.parentNode.replaceChild(newJumpBtn1, jumpBtn1);
			jumpBtn2.parentNode.replaceChild(newJumpBtn2, jumpBtn2);
			const jump1 = () => {
				const time = parseTimestamp(timestampInput1.value);
				if (time >= 0 && time <= this.getTotalDuration(player1)) {
					this.seekPlayer(player1, time);
					this.seekPlayer(player2, time);
					UI.showNotification(`Jumped to ${this.formatTimeSimple(time)}`, 'success');
					timestampInput1.value = '';
				}
			};
			const jump2 = () => {
				const time = parseTimestamp(timestampInput2.value);
				if (time >= 0 && time <= this.getTotalDuration(player2)) {
					this.seekPlayer(player1, time);
					this.seekPlayer(player2, time);
					UI.showNotification(`Jumped to ${this.formatTimeSimple(time)}`, 'success');
					timestampInput2.value = '';
				}
			};
			newJumpBtn1.addEventListener('click', (e) => {
				e.stopPropagation();
				jump1();
			});
			newJumpBtn2.addEventListener('click', (e) => {
				e.stopPropagation();
				jump2();
			});
			timestampInput1.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Enter') jump1();
			});
			timestampInput2.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Enter') jump2();
			});
			const scrollSlider1 = player1.panel.querySelector('.scroll-speed-slider');
			const scrollSlider2 = player2.panel.querySelector('.scroll-speed-slider');
			const scrollDisplay1 = player1.panel.querySelector('.scroll-speed-display');
			const scrollDisplay2 = player2.panel.querySelector('.scroll-speed-display');
			scrollSlider1.addEventListener('input', (e) => {
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const value = parseFloat(e.target.value);
				player1.scrollSpeed = value;
				player2.scrollSpeed = value;
				scrollSlider2.value = value;
				scrollDisplay1.textContent = `${value.toFixed(1)}x`;
				scrollDisplay2.textContent = `${value.toFixed(1)}x`;
				this.drawPlayer(player1);
				this.drawPlayer(player2);
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			scrollSlider2.addEventListener('input', (e) => {
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const value = parseFloat(e.target.value);
				player1.scrollSpeed = value;
				player2.scrollSpeed = value;
				scrollSlider1.value = value;
				scrollDisplay1.textContent = `${value.toFixed(1)}x`;
				scrollDisplay2.textContent = `${value.toFixed(1)}x`;
				this.drawPlayer(player1);
				this.drawPlayer(player2);
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			const rateSelect1 = player1.panel.querySelector('.playback-rate');
			const rateSelect2 = player2.panel.querySelector('.playback-rate');
			rateSelect1.addEventListener('change', (e) => {
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const value = parseFloat(e.target.value);
				player1.playbackRate = value;
				player2.playbackRate = value;
				rateSelect2.value = value;
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			rateSelect2.addEventListener('change', (e) => {
				if (syncState.isSyncing) return;
				syncState.isSyncing = true;
				const value = parseFloat(e.target.value);
				player1.playbackRate = value;
				player2.playbackRate = value;
				rateSelect1.value = value;
				Promise.resolve()
					.then(() => {
						syncState.isSyncing = false;
					});
			});
			player1.close = () => {
				if (player1.panel.parentNode) {
					this.pausePlayer(player1);
					player1.panel.remove();
				}
				if (player2.panel.parentNode) {
					this.pausePlayer(player2);
					player2.panel.remove();
				}
				this.comparisonPanel = null;
			};
			player2.close = () => {
				if (player1.panel.parentNode) {
					this.pausePlayer(player1);
					player1.panel.remove();
				}
				if (player2.panel.parentNode) {
					this.pausePlayer(player2);
					player2.panel.remove();
				}
				this.comparisonPanel = null;
			};
		}
	}
	// KEYBOARD MANAGER
	class KeyboardManager {
		constructor(state) {
			this.state = state;
			this.isInitialized = false;
			this.defaultKeybinds = {
				'bold': 'CTRL+B',
				'italic': 'CTRL+I',
				'underline': 'CTRL+U',
				'link': 'CTRL+K',
				'code': 'CTRL+E',
				'list': 'CTRL+L',
				'quote': 'CTRL+Q',
				'strikethrough': 'CTRL+SHIFT+X',
				'add-collab-note': 'ALT+N',
			};
		}
		init() {
			if (this.isInitialized) return;
			this.isInitialized = true;
			document.addEventListener('keydown', this.handleKeydown.bind(this), {
				capture: true
			});
			debug.log('Keyboard manager initialized');
		}
		handleKeydown(e) {
			if (!this.state.keyboardShortcuts) return;
			const focusedElement = document.activeElement;
			const isInTextInput = focusedElement && (
				focusedElement.tagName === 'TEXTAREA' ||
				focusedElement.tagName === 'INPUT' ||
				focusedElement.contentEditable === 'true'
			);
			if (!isInTextInput) return;
			const combo = this.getKeyCombo(e);
			const action = this.getActionForCombo(combo);
			if (action) {
				e.preventDefault();
				e.stopPropagation();
				TBActions.executeAction(action, focusedElement);
			}
		}
		getKeyCombo(e) {
			const parts = [];
			if (e.ctrlKey || e.metaKey) parts.push('CTRL');
			if (e.altKey) parts.push('ALT');
			if (e.shiftKey) parts.push('SHIFT');
			parts.push(e.key.toUpperCase());
			return parts.join('+');
		}
		getActionForCombo(combo) {
			const savedKeybinds = this.getSavedKeybinds();
			const keybinds = {
				...this.defaultKeybinds,
				...savedKeybinds
			};
			for (const [action, actionCombo] of Object.entries(keybinds)) {
				if (actionCombo === combo) return action;
			}
			return null;
		}
		getSavedKeybinds() {
			try {
				return JSON.parse(localStorage.getItem(CONFIG.KEYBINDS_KEY) || '{}');
			} catch {
				return {};
			}
		}
		saveKeybinds(keybinds) {
			try {
				localStorage.setItem(CONFIG.KEYBINDS_KEY, JSON.stringify(keybinds));
				return true;
			} catch {
				return false;
			}
		}
		resetKeybinds() {
			localStorage.removeItem(CONFIG.KEYBINDS_KEY);
		}
	}
	// BOOKMARK MANAGER
	class BookmarkManager {
		static getBookmarks(beatmapsetId) {
			const all = JSON.parse(localStorage.getItem(BOOKMARKS_CONFIG.STORAGE_KEY) || '{}');
			return all[beatmapsetId] || [];
		}
		static saveBookmark(beatmapsetId, bookmark) {
			const all = JSON.parse(localStorage.getItem(BOOKMARKS_CONFIG.STORAGE_KEY) || '{}');
			if (!all[beatmapsetId]) all[beatmapsetId] = [];
			const id = Date.now();
			all[beatmapsetId].push({
				id,
				timestamp: bookmark.timestamp,
				note: bookmark.note || '',
				created: Date.now()
			});
			localStorage.setItem(BOOKMARKS_CONFIG.STORAGE_KEY, JSON.stringify(all));
			return true;
		}
		static deleteBookmark(beatmapsetId, bookmarkId) {
			try {
				const all = JSON.parse(localStorage.getItem(BOOKMARKS_CONFIG.STORAGE_KEY) || '{}');
				if (all[beatmapsetId]) {
					all[beatmapsetId] = all[beatmapsetId].filter(b => b.id !== bookmarkId);
					localStorage.setItem(BOOKMARKS_CONFIG.STORAGE_KEY, JSON.stringify(all));
				}
				return true;
			} catch {
				return false;
			}
		}
		static exportBookmarks(beatmapsetId) {
			return this.getBookmarks(beatmapsetId);
		}
		static showBookmarksPanel() {
			const beatmapsetId = BeatmapNotesManager.getCurrentBeatmapsetId();
			if (!beatmapsetId) {
				UI.showNotification('No beatmapset detected', 'error');
				return;
			}
			let panel = document.getElementById('bookmarks-panel');
			if (panel) {
				panel.remove();
				return;
			}
			const bookmarks = this.getBookmarks(beatmapsetId);
			panel = Utils.createElement('div');
			panel.id = 'bookmarks-panel';
			panel.className = 'floating-panel';
			panel.style.cssText = 'width: 340px; max-height: 600px;';
			panel.innerHTML = `
            <button class="panel-close" style="position: absolute; top: 8px; right: 8px;">×</button>
            <div class="panel-content" style="padding-top: 20px;">
                <div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
                    <i class="fas fa-bookmark"></i> Pattern Bookmarks (${bookmarks.length})
                </div>
                <div style="margin-bottom: 14px; display: flex; gap: 6px;">
                    <input type="text" id="bookmark-note" placeholder="Note/comment..."
                        style="flex: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                    <button id="add-bookmark" class="feature-btn" style="flex: 0 0 80px; padding: 6px 10px;">Add Current</button>
                </div>
                <div style="max-height: 450px; overflow-y: auto;">
                    ${bookmarks.length === 0 ? `
                        <div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">
                            No bookmarks yet. Use the preview player and click "Add Current" to save timestamps.
                        </div>
                    ` : bookmarks.map(b => `
                        <div class="bookmark-card" data-id="${b.id}" style="background: rgba(26, 26, 26, 0.6); border-radius: 4px; padding: 10px; margin-bottom: 8px; cursor: pointer;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span style="font-family: monospace; font-size: 11px; color: #6bb6ff;">${this.formatTime(b.timestamp)}</span>
                                <button class="delete-bookmark" data-id="${b.id}" style="background: none; border: none; color: rgba(255, 107, 107, 0.7); cursor: pointer; font-size: 10px;">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                            ${b.note ? `<div style="color: rgba(255,255,255,0.85); font-size: 11px;">${Utils.sanitizeHTML(b.note)}</div>` : ''}
                            <div style="font-size: 9px; color: rgba(255,255,255,0.4);">${new Date(b.created).toLocaleString()}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
			document.body.appendChild(panel);
			UI.makeDraggable(panel, panel);
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('click', () => panel.remove());
			closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
			const addBtn = panel.querySelector('#add-bookmark');
			const noteInput = panel.querySelector('#bookmark-note');
			[addBtn, noteInput].forEach(el => el?.addEventListener('mousedown', e => e.stopPropagation()));
			addBtn.addEventListener('click', () => {
				const previewPlayer = window.beatmapPreviewInstance;
				if (!previewPlayer || !previewPlayer.currentTime) {
					UI.showNotification('Open preview player first', 'warning');
					return;
				}
				const bookmark = {
					timestamp: previewPlayer.currentTime,
					note: noteInput.value.trim()
				};
				if (this.saveBookmark(beatmapsetId, bookmark)) {
					UI.showNotification('Bookmark saved!', 'success');
					panel.remove();
					this.showBookmarksPanel();
				}
			});
			panel.addEventListener('click', (e) => {
				const card = e.target.closest('.bookmark-card');
				const deleteBtn = e.target.closest('.delete-bookmark');
				if (deleteBtn) {
					e.stopPropagation();
					const id = parseInt(deleteBtn.dataset.id);
					if (confirm('Delete this bookmark?')) {
						this.deleteBookmark(beatmapsetId, id);
						panel.remove();
						this.showBookmarksPanel();
					}
				} else if (card) {
					const id = parseInt(card.dataset.id);
					const bookmark = bookmarks.find(b => b.id === id);
					if (bookmark) {
						const previewPlayer = window.beatmapPreviewInstance;
						if (previewPlayer) {
							previewPlayer.seek(bookmark.timestamp);
							if (!previewPlayer.isPlaying) previewPlayer.play();
							UI.showNotification(`Jumped to ${this.formatTime(bookmark.timestamp)}`, 'success');
						}
					}
				}
			});
		}
		static formatTime(ms) {
			return RCCheckerManager?.formatTime ? RCCheckerManager.formatTime(ms) : `${(ms / 1000).toFixed(2)}s`;
		}
	}
	// TB ACTIONS
	let TBInstance;
	let isRecording = false;
	let recordingAction = null;
	class TBActions {
		static executeAction(action, textarea = null) {
			if (!textarea && action !== 'features') {
				textarea = TextEditor.findActiveTextarea();
			}
			if (!textarea && action !== 'features') {
				UI.showNotification('No text area found', 'error');
				return false;
			}
			switch (action) {
				case 'bold':
					return TextEditor.wrapSelectedText(textarea, '**');
				case 'italic':
					return TextEditor.wrapSelectedText(textarea, '*');
				case 'code':
					return TextEditor.wrapSelectedText(textarea, '`');
				case 'codeblock':
					return TextEditor.wrapSelectedText(textarea, '```\n', '\n```');
				case 'list':
					return TextEditor.insertTextAtCursor(textarea, '- ');
				case 'ordered':
					return TextEditor.insertTextAtCursor(textarea, '1. ');
				case 'link':
					return TextEditor.insertTextAtCursor(textarea, '[text](url)');
				case 'image':
					return TextEditor.insertTextAtCursor(textarea, '![alt](url)');
				case 'quote':
					return TextEditor.insertTextAtCursor(textarea, '> ');
				case 'indent':
					return TextEditor.insertTextAtCursor(textarea, '    ');
				case 'strikethrough':
					return TextEditor.wrapSelectedText(textarea, '~~');
				case 'underline':
					return TextEditor.wrapSelectedText(textarea, '__');
				case 'features':
					UI.toggleFeaturesPanel();
					return true;
				case 'rc-checker':
					RCCheckerManager.openRCChecker();
					return true;
				case 'preview-player': {
					const player = new BeatmapPreviewPlayer();
					player.open();
					return true;
				}
				case 'browser':
					BrowserManager.openBrowser();
					return true;
				case 'tools':
					this.openToolsPanel();
					return true;
				case 'wording':
					WordingHelperManager.showWordingPanel();
					return true;
				case 'notes':
					NotesManager.showNotesPanel();
					return true;
				case 'comparison':
					ComparisonMode.show();
					return true;
				case 'add-collab-note':
					CollabNotesManager.showAddNoteDialog();
					return true;
			}
		}
		static openToolsPanel() {
			AnalysisToolsManager.showToolsPanel();
		}
	}
	// USER INTERFACE
	class UI {
		static TB_BUTTONS = [{
				tool: 'bold',
				icon: 'bold',
				title: 'Bold (Ctrl+B)'
			},
			{
				tool: 'italic',
				icon: 'italic',
				title: 'Italic (Ctrl+I)'
			},
			{
				tool: 'underline',
				icon: 'underline',
				title: 'Underline (Ctrl+U)'
			},
			{
				tool: 'strikethrough',
				icon: 'strikethrough',
				title: 'Strikethrough (Ctrl+Shift+X)'
			},
			{
				tool: 'code',
				icon: 'code',
				title: 'Inline Code (Ctrl+E)'
			},
			{
				tool: 'codeblock',
				icon: 'file-code',
				title: 'Code Block'
			},
			{
				tool: 'link',
				icon: 'link',
				title: 'Link (Ctrl+K)'
			},
			{
				tool: 'image',
				icon: 'image',
				title: 'Image'
			},
			{
				tool: 'quote',
				icon: 'quote-right',
				title: 'Quote (Ctrl+Q)'
			},
			{
				tool: 'rc-checker',
				icon: 'search',
				title: 'RC Checker & Difficulty Info'
			},
			{
				tool: 'preview-player',
				icon: 'play-circle',
				title: 'Beatmap Preview Player'
			},
			{
				tool: 'browser',
				icon: 'globe',
				title: 'Search Browser'
			},
			{
				tool: 'notes',
				icon: 'sticky-note',
				title: 'Notes & Collab'
			},
			{
				tool: 'tools',
				icon: 'tools',
				title: 'Analysis Tools'
			},
			{
				tool: 'wording',
				icon: 'spell-check',
				title: 'Wording Helper'
			},
			{
				tool: 'comparison',
				icon: 'columns',
				title: 'Compare Difficulties'
			},
			{
				tool: 'features',
				icon: 'cog',
				title: 'Features & Settings'
			}
		];
		static NOTIFICATION_COLORS = {
			success: {
				bg: '#fff',
				text: '#000'
			},
			error: {
				bg: '#000',
				text: '#fff',
				border: '#fff'
			},
			warning: {
				bg: '#666',
				text: '#fff'
			},
			info: {
				bg: '#999',
				text: '#000'
			}
		};
		// TB CREATION
		static createTB(state) {
			const TB = Utils.createElement('div', 'osu-floating-TB');
			TB.innerHTML = `<div class="TB-buttons">${this.createTBButtons()}</div>`;
			Object.assign(TB.style, {
				left: state.position.x + 'px',
				top: state.position.y + 'px',
				width: state.size.width + 'px',
				height: state.size.height + 'px'
			});
			return TB;
		}
		static createTBButtons() {
			return this.TB_BUTTONS
				.map(btn => `<button class="osu-btn" data-tool="${btn.tool}" title="${btn.title}">
                <i class="fas fa-${btn.icon}"></i>
            </button>`)
				.join('');
		}
		static updateButtonLayout(TB) {
			const buttonsContainer = TB.querySelector('.TB-buttons');
			if (!buttonsContainer) return;
			const width = TB.offsetWidth - 16;
			const totalButtons = TB.querySelectorAll('.osu-btn').length;
			const {
				buttonsPerRow,
				buttonSize,
				gap
			} = this.calculateButtonLayout(width, totalButtons);
			Object.assign(buttonsContainer.style, {
				gridTemplateColumns: `repeat(${buttonsPerRow}, 1fr)`,
				gap: gap + 'px',
				padding: Math.max(8, buttonSize * 0.12) + 'px'
			});
			const iconScale = Utils.clamp(buttonSize / 35, 0.8, 1.6);
			TB.querySelectorAll('.osu-btn').forEach(btn => {
				Object.assign(btn.style, {
					minHeight: buttonSize + 'px',
					height: buttonSize + 'px',
					borderRadius: Math.max(5, buttonSize * 0.12) + 'px'
				});
				const icon = btn.querySelector('i');
				if (icon) {
					icon.style.fontSize = Math.max(13, 13 * iconScale) + 'px';
				}
			});
		}
		static calculateButtonLayout(width, totalButtons) {
			const minButtonSize = 28;
			const maxButtonSize = 70;
			const gap = Math.max(4, Math.floor(width / 40));
			let buttonsPerRow;
			if (totalButtons <= 4) {
				buttonsPerRow = Math.min(2, totalButtons);
			} else if (totalButtons <= 8) {
				buttonsPerRow = Math.min(3, Math.ceil(Math.sqrt(totalButtons)));
			} else {
				buttonsPerRow = Math.min(4, Math.ceil(Math.sqrt(totalButtons * 0.8)));
			}
			buttonsPerRow = Utils.clamp(
				Math.floor(width / (minButtonSize + gap)),
				1,
				Math.min(buttonsPerRow, CONFIG.MAX_BUTTONS_PER_ROW)
			);
			const availableButtonWidth = (width - (buttonsPerRow - 1) * gap) / buttonsPerRow;
			const buttonSize = Utils.clamp(availableButtonWidth, minButtonSize, maxButtonSize);
			return {
				buttonsPerRow,
				buttonSize,
				gap
			};
		}
		// DRAGGING & RESIZING
		static makeDraggable(element, handle, onDragEnd) {
			let isDragging = false;
			let startX, startY, initialX, initialY;
			const handleMouseDown = (e) => {
				isDragging = true;
				startX = e.clientX;
				startY = e.clientY;
				const rect = element.getBoundingClientRect();
				initialX = rect.left;
				initialY = rect.top;
				e.preventDefault();
				handle.style.cursor = 'grabbing';
			};
			const handleMouseMove = Utils.throttle((e) => {
				if (!isDragging) return;
				const deltaX = e.clientX - startX;
				const deltaY = e.clientY - startY;
				const newX = initialX + deltaX;
				const newY = initialY + deltaY;
				const maxX = window.innerWidth - element.offsetWidth;
				const maxY = window.innerHeight - element.offsetHeight;
				element.style.transform = 'none';
				element.style.left = Utils.clamp(newX, 0, maxX) + 'px';
				element.style.top = Utils.clamp(newY, 0, maxY) + 'px';
			}, 16);
			const handleMouseUp = () => {
				if (isDragging) {
					isDragging = false;
					handle.style.cursor = 'move';
					if (onDragEnd) {
						const rect = element.getBoundingClientRect();
						onDragEnd({
							x: rect.left,
							y: rect.top
						});
					}
				}
			};
			handle.addEventListener('mousedown', handleMouseDown);
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
			return () => {
				handle.removeEventListener('mousedown', handleMouseDown);
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};
		}
		static makeResizable(element, onResize) {
			const resizeHandle = Utils.createElement('div', 'resize-handle');
			element.appendChild(resizeHandle);
			let isResizing = false;
			let startX, startY, startWidth, startHeight;
			const handleMouseDown = (e) => {
				isResizing = true;
				startX = e.clientX;
				startY = e.clientY;
				startWidth = element.offsetWidth;
				startHeight = element.offsetHeight;
				e.preventDefault();
				e.stopPropagation();
			};
			const handleMouseMove = Utils.throttle((e) => {
				if (!isResizing) return;
				const newWidth = Math.max(CONFIG.MIN_WIDTH, startWidth + (e.clientX - startX));
				const newHeight = Math.max(CONFIG.MIN_HEIGHT, startHeight + (e.clientY - startY));
				element.style.width = newWidth + 'px';
				element.style.height = newHeight + 'px';
				UI.updateButtonLayout(element);
			}, 16);
			const handleMouseUp = () => {
				if (isResizing) {
					isResizing = false;
					if (onResize) {
						onResize({
							width: element.offsetWidth,
							height: element.offsetHeight
						});
					}
				}
			};
			resizeHandle.addEventListener('mousedown', handleMouseDown);
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
			return () => {
				resizeHandle.removeEventListener('mousedown', handleMouseDown);
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};
		}
		// NOTIFICATIONS
		static showNotification(message, type = 'success', duration = 3000) {
			const notification = Utils.createElement('div', 'osu-notification');
			notification.textContent = message;
			const colors = this.NOTIFICATION_COLORS[type] || this.NOTIFICATION_COLORS.success;
			Object.assign(notification.style, {
				position: 'fixed',
				top: '20px',
				right: '20px',
				zIndex: '10003',
				background: colors.bg,
				color: colors.text,
				padding: '12px 20px',
				borderRadius: '6px',
				fontSize: '14px',
				fontWeight: '500',
				boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
				animation: 'slideInRight 0.3s ease-out',
				border: `1px solid ${colors.border || '#333'}`
			});
			document.body.appendChild(notification);
			setTimeout(() => notification.remove(), duration);
		}
		// FEATURES PANEL
		static toggleFeaturesPanel() {
			const existingPanel = document.getElementById('osu-features-panel');
			if (existingPanel) {
				existingPanel.remove();
				return;
			}
			const panel = this.createFeaturesPanel();
			document.body.appendChild(panel);
			panel.style.cursor = 'move';
			UI.makeDraggable(panel, panel);
			this.setupPanelCloseButton(panel);
			this.setupFeaturePanelListeners(panel);
			this.setupCollabNotes(panel);
		}
		static createFeaturesPanel() {
			const panel = Utils.createElement('div');
			panel.id = 'osu-features-panel';
			panel.className = 'floating-panel';
			panel.innerHTML = `
            <button class="panel-close">×</button>
            <div class="panel-content" style="padding-top: 20px;">
                ${this.createFeatureSection('file-alt', 'Templates', [
                    { id: 'add-template', text: 'Save Current' },
                    { id: 'manage-templates', text: 'Manage All' }
                ])}
                ${this.createFeatureSection('sticky-note', 'Beatmap Notes', [
                    { id: 'beatmap-notes-toggle', text: BEATMAP_NOTES_CONFIG.enabled ? 'Enabled' : 'Disabled',
                      active: BEATMAP_NOTES_CONFIG.enabled },
                    { id: 'manage-beatmap-notes', text: 'Manage Notes' }
                ], 'Save notes specific to each beatmap')}
                ${this.createFeatureSection('music', 'Note Preview', [
                    { id: 'preview-toggle', text: NOTE_PREVIEW_CONFIG.enabled ? 'Enabled' : 'Disabled',
                      active: NOTE_PREVIEW_CONFIG.enabled }
                ], 'Hover over osu://edit links to preview patterns')}
                ${this.createFeatureSection('download', 'Export/Import', [
                    { id: 'export-settings', text: 'Export All' },
                    { id: 'import-settings', text: 'Import All' }
                ])}
            </div>
        `;
			return panel;
		}
		static createFeatureSection(icon, title, buttons, info = null) {
			const buttonHTML = buttons.map(btn =>
				`<button class="feature-btn ${btn.active ? 'toggle-btn active' : btn.id.includes('toggle') ? 'toggle-btn' : ''}"
                     id="${btn.id}">${btn.text}</button>`
			).join('');
			return `
            <div class="feature-section">
                <h4><i class="fas fa-${icon}"></i> ${title}</h4>
                <div class="feature-buttons">${buttonHTML}</div>
                ${info ? `<div class="feature-info">${info}</div>` : ''}
            </div>
        `;
		}
		static setupPanelCloseButton(panel) {
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('click', () => panel.remove());
			closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
			closeBtn.addEventListener('mouseenter', () => {
				closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
				closeBtn.style.color = '#fff';
			});
			closeBtn.addEventListener('mouseleave', () => {
				closeBtn.style.background = 'none';
				closeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
			});
		}
		static setupCollabNotes(panel) {
			const collabInput = panel.querySelector('#collab-server-ip');
			const collabBtn = panel.querySelector('#collab-connect');
			if (collabInput) {
				collabInput.value = localStorage.getItem('collab_server_ip') || '';
			}
			if (collabBtn) {
				collabBtn.addEventListener('click', () => {
					const ip = collabInput.value.trim();
					if (ip) {
						localStorage.setItem('collab_server_ip', ip);
						CollabNotesManager.init();
						UI.showNotification('Collab notes connecting...', 'info');
					}
				});
			}
		}
		static setupFeaturePanelListeners(panel) {
			this.setupToggleButton(panel, '#shortcuts-toggle', () => {
				if (!TBInstance) return;
				TBInstance.state.keyboardShortcuts = !TBInstance.state.keyboardShortcuts;
				if (TBInstance.state.keyboardShortcuts) {
					TBInstance.keyboardManager.init();
				}
				TBInstance.state.save();
				return TBInstance.state.keyboardShortcuts;
			});
			this.setupToggleButton(panel, '#beatmap-notes-toggle', () => {
				BEATMAP_NOTES_CONFIG.enabled = !BEATMAP_NOTES_CONFIG.enabled;
				localStorage.setItem('beatmapNotes_disabled',
					BEATMAP_NOTES_CONFIG.enabled ? 'false' : 'true');
				if (TBInstance?.beatmapNotesPanel) {
					if (BEATMAP_NOTES_CONFIG.enabled) {
						if (!document.body.contains(TBInstance.beatmapNotesPanel)) {
							document.body.appendChild(TBInstance.beatmapNotesPanel);
						}
					} else {
						TBInstance.beatmapNotesPanel.remove();
					}
				}
				return BEATMAP_NOTES_CONFIG.enabled;
			});
			this.setupToggleButton(panel, '#preview-toggle', () => {
				NOTE_PREVIEW_CONFIG.enabled = !NOTE_PREVIEW_CONFIG.enabled;
				localStorage.setItem('maniaPreview_disabled',
					NOTE_PREVIEW_CONFIG.enabled ? 'false' : 'true');
				return NOTE_PREVIEW_CONFIG.enabled;
			});
			this.setupButton(panel, '#manage-templates', () => {
				panel.remove();
				UI.showTemplateManager();
			});
			this.setupButton(panel, '#manage-beatmap-notes', () => {
				panel.remove();
				if (TBInstance) TBInstance.showBeatmapNotesPanel();
			});
			this.setupButton(panel, '#add-template', () => {
				const textarea = TextEditor.findActiveTextarea();
				if (textarea?.value.trim()) {
					TemplateManager.addTemplate(textarea.value) ?
						UI.showNotification('Template saved!', 'success') :
						UI.showNotification('Failed to save template', 'error');
				} else {
					UI.showNotification('No text to save', 'warning');
				}
			});
			this.setupButton(panel, '#export-settings', () => this.exportSettings());
			this.setupButton(panel, '#import-settings', () => this.importSettings());
		}
		static setupToggleButton(panel, selector, toggleFn) {
			const btn = panel.querySelector(selector);
			if (!btn) return;
			btn.addEventListener('click', (e) => {
				const newState = toggleFn();
				e.target.textContent = newState ? 'Enabled' : 'Disabled';
				e.target.classList.toggle('active', newState);
			});
		}
		static setupButton(panel, selector, clickFn) {
			const btn = panel.querySelector(selector);
			if (btn) btn.addEventListener('click', clickFn);
		}
		static exportSettings() {
			const data = {
				version: '6.2',
				templates: TemplateManager.getTemplates(),
				keybinds: TBInstance.keyboardManager.getSavedKeybinds(),
				beatmapNotes: BeatmapNotesManager.exportAllNotes(),
				settings: {
					keyboardShortcuts: TBInstance.state.keyboardShortcuts,
					position: TBInstance.state.position,
					size: TBInstance.state.size
				}
			};
			const blob = new Blob([JSON.stringify(data, null, 2)], {
				type: 'application/json'
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = 'osu-TB-backup.json';
			link.click();
			URL.revokeObjectURL(url);
			UI.showNotification('Settings exported!', 'success');
		}
		static importSettings() {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json';
			input.onchange = (e) => {
				const file = e.target.files[0];
				if (!file) return;
				const reader = new FileReader();
				reader.onload = (e) => {
					try {
						const data = JSON.parse(e.target.result);
						if (data.templates) TemplateManager.saveTemplates(data.templates);
						if (data.keybinds) TBInstance.keyboardManager.saveKeybinds(data.keybinds);
						if (data.beatmapNotes) BeatmapNotesManager.importNotes(data.beatmapNotes);
						if (data.settings) {
							Object.assign(TBInstance.state, data.settings);
							TBInstance.state.save();
						}
						UI.showNotification('Settings imported! Reload page.', 'success');
					} catch (error) {
						UI.showNotification('Invalid settings file', 'error');
					}
				};
				reader.readAsText(file);
			};
			input.click();
		}
		// TEMPLATE MANAGER
		static showTemplateManager() {
			let manager = document.getElementById('template-manager');
			if (manager) manager.remove();
			const templates = TemplateManager.getTemplates();
			manager = this.createTemplateManager(templates);
			document.body.appendChild(manager);
			manager.style.cursor = 'move';
			UI.makeDraggable(manager, manager);
			this.setupPanelCloseButton(manager);
			this.setupTemplateListeners(manager, templates);
		}
		static createTemplateManager(templates) {
			const manager = Utils.createElement('div');
			manager.id = 'template-manager';
			manager.className = 'floating-panel';
			manager.style.width = '500px';
			manager.style.maxHeight = '600px';
			manager.innerHTML = `
            <button class="panel-close">×</button>
            <div class="panel-content" style="padding-top: 20px;">
                <div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
                    <i class="fas fa-file-alt"></i> Template Manager (${templates.length})
                </div>
                <div class="template-actions">
                    <button class="feature-btn" id="clear-all-templates">Clear All</button>
                    <button class="feature-btn" id="export-templates">Export</button>
                    <button class="feature-btn" id="import-templates">Import</button>
                </div>
                <div class="template-list-container">
                    ${templates.length === 0
                        ? '<div class="no-templates">No templates saved yet. Create one by typing text and clicking "Save Current".</div>'
                        : templates.map(t => this.createTemplateCard(t)).join('')
                    }
                </div>
            </div>
        `;
			return manager;
		}
		static createTemplateCard(template) {
			return `
            <div class="template-card" data-id="${template.id}">
                <div class="template-preview">${Utils.sanitizeHTML(template.preview)}</div>
                <div class="template-meta">
                    Created: ${new Date(template.created).toLocaleString()}
                </div>
                <div class="template-actions-card">
                    <button class="template-btn use-template" data-id="${template.id}">Use</button>
                    <button class="template-btn edit-template" data-id="${template.id}">Edit</button>
                    <button class="template-btn delete-template" data-id="${template.id}">Delete</button>
                </div>
            </div>
        `;
		}
		static setupTemplateListeners(manager, templates) {
			manager.addEventListener('click', (e) => {
				const templateId = parseInt(e.target.dataset.id);
				const template = templates.find(t => t.id === templateId);
				if (e.target.classList.contains('use-template') && template) {
					const textarea = TextEditor.findActiveTextarea();
					if (textarea) {
						TextEditor.insertTextAtCursor(textarea, template.text);
						UI.showNotification('Template inserted!', 'success');
						manager.remove();
					} else {
						UI.showNotification('No textarea found', 'error');
					}
				} else if (e.target.classList.contains('edit-template') && template) {
					const newText = prompt('Edit template:', template.text);
					if (newText !== null && newText.trim()) {
						const updatedTemplates = templates.map(t =>
							t.id === templateId ? {
								...t,
								text: newText.trim(),
								preview: newText.trim().substring(0, 60) +
									(newText.length > 60 ? '...' : '')
							} :
							t
						);
						if (TemplateManager.saveTemplates(updatedTemplates)) {
							manager.remove();
							UI.showTemplateManager();
							UI.showNotification('Template updated!', 'success');
						} else {
							UI.showNotification('Failed to update template', 'error');
						}
					}
				} else if (e.target.classList.contains('delete-template')) {
					if (confirm('Delete this template?')) {
						if (TemplateManager.deleteTemplate(templateId)) {
							manager.remove();
							UI.showTemplateManager();
							UI.showNotification('Template deleted', 'success');
						} else {
							UI.showNotification('Failed to delete template', 'error');
						}
					}
				}
			});
			manager.querySelector('#clear-all-templates').addEventListener('click', () => {
				if (confirm('Delete all templates? This cannot be undone.')) {
					TemplateManager.clearAll();
					manager.remove();
					UI.showTemplateManager();
					UI.showNotification('All templates cleared', 'success');
				}
			});
			manager.querySelector('#export-templates').addEventListener('click', () => {
				const templates = TemplateManager.getTemplates();
				const blob = new Blob([JSON.stringify(templates, null, 2)], {
					type: 'application/json'
				});
				const url = URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = url;
				link.download = 'osu-TB-templates.json';
				link.click();
				URL.revokeObjectURL(url);
				UI.showNotification('Templates exported!', 'success');
			});
			manager.querySelector('#import-templates').addEventListener('click', () => {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = '.json';
				input.onchange = (e) => {
					const file = e.target.files[0];
					if (!file) return;
					const reader = new FileReader();
					reader.onload = (e) => {
						try {
							const importedTemplates = JSON.parse(e.target.result);
							const existingTemplates = TemplateManager.getTemplates();
							const mergedTemplates = [...importedTemplates, ...existingTemplates];
							if (TemplateManager.saveTemplates(mergedTemplates)) {
								manager.remove();
								UI.showTemplateManager();
								UI.showNotification(
									`Imported ${importedTemplates.length} templates!`,
									'success'
								);
							} else {
								UI.showNotification('Failed to import templates', 'error');
							}
						} catch (error) {
							UI.showNotification('Invalid template file', 'error');
						}
					};
					reader.readAsText(file);
				};
				input.click();
			});
		}
	}
	// STYLE MANAGER
	class StyleManager {
		static injectStyles() {
			if (document.getElementById('osu-TB-styles')) return;
			const style = Utils.createElement('style');
			style.id = 'osu-TB-styles';
			style.textContent = this.getStyles();
			document.head.appendChild(style);
			debug.log('Styles injected');
		}
		static getStyles() {
			return `
            :root {
                --bg-primary: rgba(12, 12, 12, 0.95);
                --bg-secondary: rgba(26, 26, 26, 0.6);
                --bg-hover: rgba(255, 255, 255, 0.12);
                --bg-active: rgba(255, 255, 255, 0.08);
                --bg-highlight: rgba(255, 255, 255, 0.95);
                --bg-code: rgba(0, 0, 0, 0.4);
                --bg-overlay: rgba(255, 255, 255, 0.04);
                --border-primary: rgba(255, 255, 255, 0.06);
                --border-secondary: rgba(255, 255, 255, 0.08);
                --border-hover: rgba(255, 255, 255, 0.2);
                --border-scrollbar: rgba(255, 255, 255, 0.1);
                --text-primary: #eee;
                --text-secondary: rgba(255, 255, 255, 0.85);
                --text-tertiary: rgba(255, 255, 255, 0.7);
                --text-muted: rgba(255, 255, 255, 0.6);
                --text-dim: rgba(255, 255, 255, 0.4);
                --text-faint: rgba(255, 255, 255, 0.3);
                --text-white: #fff;
                --text-dark: #0a0a0a;
                --shadow-sm: 0 6px 18px rgba(0, 0, 0, 0.6);
                --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.8);
                --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.8);
                --radius-sm: 3px;
                --radius-md: 4px;
                --radius-lg: 6px;
                --radius-xl: 8px;
                --transition-fast: 0.15s ease;
                --transition-normal: 0.2s ease;
                --error-color: #ff6b6b;
                --warning-color: #ffd93d;
                --success-color: #4caf50;
            }
            .osu-floating-TB {
                position: fixed;
                z-index: 9999;
                background: var(--bg-primary);
                border: 1px solid var(--border-primary);
                border-radius: var(--radius-lg);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: var(--shadow-sm);
                backdrop-filter: blur(4px);
                transition: all var(--transition-normal);
                user-select: none;
                cursor: move;
            }
            .TB-buttons {
                flex: 1;
                padding: 6px;
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 4px;
                overflow-y: auto;
                align-content: start;
            }
            .osu-btn {
                min-height: 32px;
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                color: var(--text-tertiary);
                border-radius: var(--radius-md);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all var(--transition-fast);
                position: relative;
                overflow: hidden;
                padding: 6px;
            }
            .osu-btn:hover {
                background: var(--bg-hover);
                border-color: var(--border-hover);
                color: var(--text-white);
                transform: translateY(-1px);
            }
            .osu-btn:active {
                background: var(--bg-active);
                transform: translateY(0);
            }
            .resize-handle {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 12px;
                height: 12px;
                background: linear-gradient(135deg, transparent 50%, var(--border-secondary) 50%);
                cursor: se-resize;
                border-radius: 0 0 var(--radius-lg) 0;
                opacity: 0.4;
                transition: opacity var(--transition-normal);
            }
            .resize-handle:hover {
                opacity: 0.8;
            }
            .TB-buttons::-webkit-scrollbar,
            .panel-content::-webkit-scrollbar,
            .preview-content::-webkit-scrollbar,
            .template-list-container::-webkit-scrollbar,
            .violations-list::-webkit-scrollbar {
                width: 4px;
            }
            .TB-buttons::-webkit-scrollbar-track,
            .panel-content::-webkit-scrollbar-track,
            .preview-content::-webkit-scrollbar-track,
            .template-list-container::-webkit-scrollbar-track,
            .violations-list::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.02);
                border-radius: 2px;
            }
            .TB-buttons::-webkit-scrollbar-thumb,
            .panel-content::-webkit-scrollbar-thumb,
            .template-list-container::-webkit-scrollbar-thumb,
            .violations-list::-webkit-scrollbar-thumb {
                background: var(--border-secondary);
                border-radius: 2px;
            }
            .preview-content::-webkit-scrollbar {
                width: 6px;
            }
            .preview-content::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.15);
                border-radius: var(--radius-sm);
            }
            .preview-content::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.25);
            }
            .floating-panel {
                position: fixed;
                z-index: 10000;
                width: 320px;
                background: var(--bg-primary);
                border: 1px solid var(--border-primary);
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-md);
                overflow: hidden;
                backdrop-filter: blur(4px);
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
            }
            .panel-header {
                background: rgba(26, 26, 26, 0.8);
                padding: 10px 14px;
                border-bottom: 1px solid var(--border-primary);
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: var(--text-primary);
                font-weight: 600;
                cursor: move;
                font-size: 12px;
            }
            .panel-close {
                background: none;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                padding: 4px 8px;
                border-radius: var(--radius-sm);
                transition: all var(--transition-normal);
                font-size: 16px;
            }
            .panel-close:hover {
                background: var(--bg-hover);
                color: var(--text-white);
            }
            .panel-content {
                padding: 14px;
                max-height: 500px;
                overflow-y: auto;
            }
            .feature-section {
                margin-bottom: 16px;
                padding-bottom: 14px;
                border-bottom: 1px solid var(--border-primary);
            }
            .feature-section:last-child {
                border-bottom: none;
                margin-bottom: 0;
            }
            .feature-section h4 {
                color: var(--text-primary);
                margin: 0 0 10px 0;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 6px;
                font-weight: 600;
            }
            .feature-buttons {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            .feature-btn {
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                color: var(--text-tertiary);
                padding: 7px 12px;
                border-radius: var(--radius-md);
                cursor: pointer;
                font-size: 11px;
                transition: all var(--transition-fast);
                flex: 1;
                min-width: 70px;
            }
            .feature-btn:hover {
                background: var(--bg-hover);
                color: var(--text-white);
                border-color: var(--border-hover);
            }
            .feature-btn.active {
                background: var(--bg-highlight);
                border-color: var(--bg-highlight);
                color: var(--text-dark);
            }
            .feature-info {
                margin-top: 6px;
                font-size: 10px;
                color: var(--text-dim);
                font-style: italic;
            }
            .osu-live-preview {
                position: fixed !important;
                z-index: 10001 !important;
                width: 340px;
                max-height: 500px;
                background: var(--bg-primary);
                pointer-events: auto !important;
                display: block !important;
                border: 1px solid var(--border-scrollbar);
                border-radius: var(--radius-xl);
                overflow: hidden;
                box-shadow: var(--shadow-lg);
                backdrop-filter: blur(10px);
                animation: slideInFromRight 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            }
            .preview-content {
                padding: 12px 14px;
                color: var(--text-secondary);
                font-size: 12px;
                max-height: 440px;
                overflow-y: auto;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                line-height: 1.6;
                word-wrap: break-word;
            }
            .preview-content h1,
            .preview-content h2,
            .preview-content h3 {
                margin: 14px 0 8px 0;
                line-height: 1.3;
                color: var(--text-white);
            }
            .preview-content h1 {
                font-size: 20px;
                border-bottom: 1px solid var(--border-scrollbar);
                padding-bottom: 6px;
            }
            .preview-content h2 {
                font-size: 18px;
                border-bottom: 1px solid var(--border-primary);
                padding-bottom: 4px;
            }
            .preview-content h3 {
                font-size: 16px;
            }
            .preview-content pre {
                background: var(--bg-code);
                border: 1px solid var(--border-secondary);
                padding: 10px;
                border-radius: var(--radius-md);
                overflow-x: auto;
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                margin: 10px 0;
                font-size: 12px;
                line-height: 1.4;
            }
            .preview-content code {
                background: var(--bg-code);
                border: 1px solid var(--border-secondary);
                padding: 2px 5px;
                border-radius: var(--radius-sm);
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                font-size: 11px;
                color: rgba(255, 255, 255, 0.9);
            }
            .preview-content blockquote {
                border-left: 3px solid var(--text-faint);
                padding-left: 12px;
                margin: 10px 0;
                font-style: italic;
                color: var(--text-tertiary);
                background: rgba(255, 255, 255, 0.02);
                padding: 10px 12px;
                border-radius: 0 var(--radius-md) var(--radius-md) 0;
            }
            .preview-content ul,
            .preview-content ol {
                margin: 10px 0;
                padding-left: 20px;
            }
            .preview-content li {
                margin: 4px 0;
                line-height: 1.4;
            }
            .preview-content a {
                color: rgba(255, 255, 255, 0.9);
                text-decoration: none;
                border-bottom: 1px solid var(--text-faint);
                transition: border-color var(--transition-normal);
            }
            .preview-content a:hover {
                border-bottom-color: var(--text-white);
            }
            .preview-content strong {
                color: var(--text-white);
                font-weight: 600;
            }
            .preview-content em {
                color: var(--text-secondary);
            }
            .preview-content del {
                color: var(--text-dim);
            }
            .preview-content u {
                color: var(--text-white);
            }
            .keybind-info {
                margin-bottom: 12px;
                padding: 10px;
                background: var(--bg-overlay);
                border: 1px solid var(--border-scrollbar);
                border-radius: var(--radius-md);
                color: var(--text-muted);
                font-size: 11px;
                text-align: center;
            }
            .keybind-list {
                margin-bottom: 16px;
            }
            .keybind-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            }
            .keybind-item:last-child {
                border-bottom: none;
            }
            .action-name {
                flex: 1;
                color: var(--text-primary);
                font-size: 12px;
                text-transform: capitalize;
                font-weight: 500;
            }
            .keybind-input {
                background: var(--bg-code);
                border: 1px solid var(--border-secondary);
                color: var(--text-white);
                padding: 6px 10px;
                border-radius: var(--radius-md);
                font-size: 11px;
                width: 110px;
                text-align: center;
                font-family: 'Consolas', 'Monaco', monospace;
            }
            .keybind-change {
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                color: var(--text-tertiary);
                padding: 6px 14px;
                border-radius: var(--radius-md);
                cursor: pointer;
                font-size: 11px;
                transition: all var(--transition-fast);
                min-width: 65px;
            }
            .keybind-change:hover {
                background: var(--bg-hover);
                color: var(--text-white);
            }
            .keybind-change.recording {
                background: var(--bg-highlight);
                color: var(--text-dark);
                animation: pulse 1s infinite;
            }
            .keybind-actions {
                display: flex;
                gap: 10px;
            }
            .keybind-actions .feature-btn {
                flex: 1;
                text-align: center;
            }
            .template-actions {
                display: flex;
                gap: 6px;
                margin-bottom: 12px;
            }
            .template-actions .feature-btn {
                flex: 1;
                text-align: center;
            }
            .template-list-container {
                max-height: 400px;
                overflow-y: auto;
            }
            .no-templates {
                text-align: center;
                color: var(--text-faint);
                padding: 30px 16px;
                font-style: italic;
                line-height: 1.5;
                font-size: 11px;
            }
            .template-card {
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                border-radius: var(--radius-md);
                padding: 12px;
                margin-bottom: 10px;
                transition: all var(--transition-fast);
            }
            .template-card:hover {
                border-color: rgba(255, 255, 255, 0.15);
                background: var(--bg-active);
                transform: translateY(-1px);
            }
            .template-preview {
                color: var(--text-primary);
                font-size: 13px;
                margin-bottom: 10px;
                line-height: 1.4;
                word-break: break-word;
                max-height: 70px;
                overflow: hidden;
            }
            .template-meta {
                color: var(--text-dim);
                font-size: 10px;
                margin-bottom: 10px;
            }
            .template-actions-card {
                display: flex;
                gap: 6px;
            }
            .template-btn {
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                color: var(--text-tertiary);
                padding: 5px 10px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 10px;
                transition: all var(--transition-fast);
                flex: 1;
                text-align: center;
            }
            .template-btn:hover {
                background: var(--bg-hover);
                color: var(--text-white);
            }
            .template-btn.use-template {
                background: var(--bg-highlight);
                border-color: var(--bg-highlight);
                color: var(--text-dark);
            }
            .template-btn.use-template:hover {
                background: rgba(255, 255, 255, 0.85);
            }
            .rc-summary {
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                border-radius: var(--radius-md);
                padding: 12px;
                margin-bottom: 14px;
            }
            .rc-info-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
                margin-bottom: 10px;
                font-size: 12px;
                color: var(--text-primary);
            }
            .rc-violations-summary {
                display: flex;
                gap: 12px;
                font-size: 13px;
                font-weight: 600;
                padding-top: 10px;
                border-top: 1px solid var(--border-primary);
            }
            .error-count {
                color: var(--error-color);
            }
            .warning-count {
                color: var(--warning-color);
            }
            .no-violations {
                text-align: center;
                padding: 40px 20px;
                color: var(--success-color);
            }
            .no-violations i {
                font-size: 48px;
                margin-bottom: 12px;
                display: block;
            }
            .violations-list {
                max-height: 500px;
                overflow-y: auto;
            }
            .violation-card {
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                border-radius: var(--radius-md);
                padding: 10px;
                margin-bottom: 8px;
                transition: all var(--transition-fast);
            }
            .violation-header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 6px;
            }
            .violation-type {
                font-weight: 600;
                color: var(--text-primary);
                font-size: 11px;
            }
            .violation-severity {
                text-transform: uppercase;
                font-size: 9px;
                padding: 2px 5px;
                border-radius: var(--radius-sm);
                font-weight: 600;
            }
            .violation-message {
                color: var(--text-secondary);
                font-size: 11px;
                margin-bottom: 5px;
                line-height: 1.4;
            }
            .violation-time {
                font-size: 10px;
                color: rgba(255, 255, 255, 0.5);
                font-family: 'Consolas', 'Monaco', monospace;
                margin-bottom: 5px;
            }
            .violation-rule {
                font-size: 10px;
                color: var(--text-dim);
                font-style: italic;
                border-top: 1px solid rgba(255, 255, 255, 0.04);
                padding-top: 5px;
                margin-top: 5px;
            }
            .copy-notes-btn {
                background: var(--bg-secondary);
                border: 1px solid var(--border-secondary);
                color: var(--text-tertiary);
                padding: 5px 8px;
                border-radius: var(--radius-md);
                cursor: pointer;
                font-size: 10px;
                transition: all var(--transition-fast);
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }
            .copy-notes-btn:hover {
                background: var(--bg-hover);
                color: var(--text-white);
            }
            .copy-notes-btn i {
                font-size: 10px;
            }
            #mania-preview-tooltip {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #mania-preview-tooltip canvas {
                display: block;
                border-radius: var(--radius-md);
            }
            .density-scrollbar {
                position: absolute;
                top: 0;
                right: 0;
                width: 12px;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                border-left: 1px solid var(--border-scrollbar);
            }
            .density-bar {
                position: absolute;
                left: 0;
                width: 100%;
                background: rgba(255, 255, 255, 0.3);
                transition: background var(--transition-normal);
            }
            .density-bar.high {
                background: rgba(255, 100, 100, 0.6);
            }
            .density-bar.medium {
                background: rgba(255, 200, 100, 0.5);
            }
            .density-indicator {
                position: absolute;
                left: 0;
                width: 100%;
                height: 3px;
                background: rgba(255, 255, 255, 0.9);
                box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
            }
            .violation-marker {
                position: absolute;
                left: 0;
                width: 100%;
                height: 2px;
                cursor: pointer;
                transition: all var(--transition-normal);
            }
            .violation-marker.error {
                background: var(--error-color);
                box-shadow: 0 0 3px var(--error-color);
            }
            .violation-marker.warning {
                background: var(--warning-color);
                box-shadow: 0 0 3px var(--warning-color);
            }
            .violation-marker:hover {
                height: 4px;
                box-shadow: 0 0 6px currentColor;
            }
            #osu-editor-context-menu {
                animation: contextMenuFadeIn 0.15s ease-out;
            }
            .context-menu-item:active {
                transform: scale(0.98);
            }
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideInFromRight {
                from {
                    transform: translateX(20px);
                    opacity: 0;
                    scale: 0.98;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                    scale: 1;
                }
            }
            @keyframes pulse {
                0%, 100% {
                    opacity: 1;
                }
                50% {
                    opacity: 0.6;
                }
            }
            @keyframes playbackPulse {
                0%, 100% {
                    box-shadow: 0 0 10px rgba(255, 255, 255, 0.8), 0 0 20px rgba(255, 255, 255, 0.4);
                    opacity: 1;
                }
                50% {
                    box-shadow: 0 0 15px rgba(255, 255, 255, 1), 0 0 30px rgba(255, 255, 255, 0.6);
                    opacity: 0.9;
                }
            }
            @keyframes playbackPulseBeat {
                0% {
                    box-shadow: 0 0 8px rgba(255, 255, 255, 0.6), 0 0 16px rgba(255, 255, 255, 0.3);
                    opacity: 0.9;
                }
                100% {
                    box-shadow: 0 0 20px rgba(255, 255, 255, 1), 0 0 40px rgba(255, 255, 255, 0.8);
                    opacity: 1;
                }
            }
            @keyframes contextMenuFadeIn {
                from {
                    opacity: 0;
                    transform: scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
        `;
		}
	}
	// BEATMAP PARSER
	class BeatmapParser {
		static DIFFICULTY_PATTERNS = [{
				keywords: ['expert', 'extra', 'extreme', 'exhaust'],
				level: 'Expert'
			},
			{
				keywords: ['insane', 'lunatic', 'another'],
				level: 'Insane'
			},
			{
				keywords: ['hard', 'advanced', 'hyper'],
				level: 'Hard'
			},
			{
				keywords: ['normal'],
				level: 'Normal'
			},
			{
				keywords: ['easy', 'beginner', 'novice'],
				level: 'Easy'
			}
		];
		static parseOsuContent(content) {
			const lines = content.split('\n');
			const data = {
				version: '',
				difficulty: 'Normal',
				bpm: 180,
				hp: 5,
				od: 5,
				cs: 4,
				cols: 4,
				notes: [],
				timingPoints: []
			};
			let section = '';
			const metadata = {};
			const difficulty = {};
			const timingPoints = [];
			const notes = [];
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.startsWith('[')) {
					section = line;
					continue;
				}
				if (!line || line.startsWith('//')) continue;
				switch (section) {
					case '[Metadata]':
						if (line.startsWith('Version:')) {
							data.version = line.slice(8).trim();
							data.difficulty = this.detectDifficulty(data.version);
						}
						break;
					case '[Difficulty]':
						this.parseDifficultyLine(line, data);
						break;
					case '[TimingPoints]':
						this.parseTimingPoint(line, data.timingPoints);
						break;
					case '[HitObjects]':
						this.parseHitObject(line, data);
						break;
				}
			}
			data.notes.sort((a, b) => a.time - b.time);
			if (data.timingPoints.length > 0) {
				data.bpm = Math.round(60000 / data.timingPoints[0].beatLength);
			}
			data.cols = data.cs;
			return data;
		}
		static parseDifficultyLine(line, data) {
			const colonIdx = line.indexOf(':');
			if (colonIdx === -1) return;
			const key = line.slice(0, colonIdx);
			const value = parseFloat(line.slice(colonIdx + 1));
			switch (key) {
				case 'HPDrainRate':
					data.hp = value;
					break;
				case 'OverallDifficulty':
					data.od = value;
					break;
				case 'CircleSize':
					data.cs = Math.max(1, Math.min(18, Math.floor(value))) || 4;
					break;
			}
		}
		static parseTimingPoint(line, timingPoints) {
			const parts = line.split(',');
			if (parts.length < 2) return;
			const beatLength = parseFloat(parts[1]);
			if (beatLength > 0) {
				timingPoints.push({
					time: parseFloat(parts[0]),
					beatLength
				});
			}
		}
		static parseHitObject(line, data) {
			const parts = line.split(',');
			if (parts.length < 4) return;
			const x = parseInt(parts[0]);
			const time = parseInt(parts[2]);
			const type = parseInt(parts[3]);
			const col = Utils.clamp(Math.floor((x * data.cs) / 512), 0, data.cs - 1);
			const note = {
				time,
				col,
				isLN: !!(type & 128),
				endTime: null,
				len: 0,
				id: `${time}-${col}-${Math.random()}`
			};
			if (note.isLN && parts.length > 5) {
				const endTime = parseInt(parts[5].split(':')[0]);
				note.endTime = endTime;
				note.len = endTime - time;
			}
			data.notes.push(note);
		}
		static detectDifficulty(versionName) {
			const lower = versionName.toLowerCase();
			for (const pattern of this.DIFFICULTY_PATTERNS) {
				if (pattern.keywords.some(kw => lower.includes(kw))) {
					return pattern.level;
				}
			}
			return /\d+\.?\d*\*/.test(versionName) ? 'Hard' : 'Normal';
		}
		static parsePattern(url) {
			if (!url) return {
				timestamps: new Set()
			};
			const match = url.match(/\(([^)]+)\)/);
			if (!match) return {
				timestamps: new Set()
			};
			const content = match[1].replace(/;/g, ',').trim();
			const pieces = content.split(',');
			const timestamps = new Set();
			for (const piece of pieces) {
				const parts = piece.split('|');
				if (parts.length < 2) continue;
				const time = Number(parts[0]);
				if (!isNaN(time)) timestamps.add(time);
			}
			return {
				timestamps
			};
		}
	}
	// WEB EDITOR INTEGRATION
	class WebEditorIntegration {
		static parseEditorLink(href) {
			const match = href.match(/osu:\/\/edit\/.*?\(([^)]+)\)/);
			if (!match) return null;
			const content = match[1].replace(/;/g, ',').trim();
			const pieces = content.split(',');
			const notes = [];
			for (const piece of pieces) {
				const parts = piece.split('|');
				if (parts.length < 2) continue;
				const time = Number(parts[0]);
				const col = Number(parts[1]);
				if (!isNaN(time) && !isNaN(col)) {
					notes.push({
						time,
						col
					});
				}
			}
			return notes;
		}
		static async openInWebEditor(beatmapId, notes) {
			if (!beatmapId || !notes?.length) return;
			const firstNote = notes[0];
			const timestamp = firstNote.time;
			let previewPlayer = window.beatmapPreviewInstance;
			if (!previewPlayer || !document.getElementById('beatmap-preview-player')) {
				previewPlayer = new BeatmapPreviewPlayer(true);
				await new Promise(resolve => setTimeout(resolve, 500));
			}
			if (previewPlayer?.beatmapData) {
				previewPlayer.seek(timestamp);
				previewPlayer.highlightedNotes = new Set(notes.map(n => n.time));
				previewPlayer.draw();
				UI.showNotification(
					`Jumped to ${RCCheckerManager.formatTime(timestamp)}`,
					'success'
				);
			}
		}
	}
	// NOTE PREVIEW HANDLER
	class NotePreviewHandler {
		constructor() {
			this.tooltip = null;
			this.hoverTimer = null;
			this.currentTarget = null;
			this.beatmapCache = new Map();
			this.init();
		}
		init() {
			this.createTooltip();
			this.attachToLinks();
			this.setupContextMenu();
		}
		// CONTEXT MENU
		setupContextMenu() {
			document.addEventListener('contextmenu', (e) => {
				const link = e.target.closest('a[href*="osu://edit"]');
				if (!link) return;
				e.preventDefault();
				e.stopPropagation();
				this.showContextMenu(e, link);
			}, {
				capture: true
			});
		}
		showContextMenu(event, link) {
			document.getElementById('osu-editor-context-menu')?.remove();
			const menu = this.createContextMenuElement(event);
			const beatmapId = this.getCurrentBeatmapId();
			const notes = WebEditorIntegration.parseEditorLink(link.href);
			this.setupContextMenuItems(menu, link, beatmapId, notes, event);
			document.body.appendChild(menu);
			setTimeout(() => {
				const removeMenu = (e) => {
					if (!menu.contains(e.target)) {
						menu.remove();
						document.removeEventListener('click', removeMenu);
					}
				};
				document.addEventListener('click', removeMenu);
			}, 0);
		}
		createContextMenuElement(event) {
			const menu = Utils.createElement('div');
			menu.id = 'osu-editor-context-menu';
			Object.assign(menu.style, {
				position: 'fixed',
				left: event.clientX + 'px',
				top: event.clientY + 'px',
				background: 'rgba(12, 12, 12, 0.98)',
				border: '1px solid rgba(255, 255, 255, 0.15)',
				borderRadius: '6px',
				padding: '4px',
				zIndex: '999999',
				boxShadow: '0 4px 20px rgba(0, 0, 0, 0.8)',
				backdropFilter: 'blur(10px)',
				minWidth: '180px'
			});
			menu.innerHTML = `
            <div class="context-menu-item" data-action="open-editor">
                <i class="fas fa-external-link-alt"></i>
                <span>Open in Web Editor</span>
            </div>
            <div class="context-menu-item" data-action="copy-link">
                <i class="fas fa-copy"></i>
                <span>Copy Link</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="show-preview">
                <i class="fas fa-eye"></i>
                <span>Show Pattern Preview</span>
            </div>
        `;
			const style = document.createElement('style');
			style.textContent = `
            .context-menu-item {
                padding: 8px 12px;
                color: #fff;
                font-size: 12px;
                cursor: pointer;
                border-radius: 4px;
                transition: background 0.15s ease;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .context-menu-item:hover {
                background: rgba(255, 255, 255, 0.12);
            }
            .context-menu-item i {
                font-size: 10px;
                opacity: 0.7;
            }
            .context-menu-divider {
                height: 1px;
                background: rgba(255, 255, 255, 0.08);
                margin: 4px 0;
            }
        `;
			menu.appendChild(style);
			return menu;
		}
		setupContextMenuItems(menu, link, beatmapId, notes, event) {
			menu.addEventListener('click', (e) => {
				const item = e.target.closest('.context-menu-item');
				if (!item) return;
				const action = item.dataset.action;
				switch (action) {
					case 'open-editor':
						if (beatmapId && notes) {
							WebEditorIntegration.openInWebEditor(beatmapId, notes);
						} else {
							UI.showNotification('Could not parse editor link', 'error');
						}
						break;
					case 'copy-link':
						navigator.clipboard.writeText(link.href)
							.then(() => UI.showNotification('Link copied!', 'success'))
							.catch(() => UI.showNotification('Failed to copy', 'error'));
						break;
					case 'show-preview':
						this.showPreview(link, event);
						break;
				}
				menu.remove();
			});
		}
		// TOOLTIP
		createTooltip() {
			this.tooltip = Utils.createElement('div');
			this.tooltip.id = 'mania-preview-tooltip';
			Object.assign(this.tooltip.style, {
				position: 'fixed',
				pointerEvents: 'none',
				left: '0px',
				top: '0px',
				display: 'none',
				padding: '8px',
				background: 'rgba(12,12,12,0.95)',
				color: '#eee',
				border: '1px solid rgba(255, 255, 255, 0.06)',
				borderRadius: '6px',
				boxShadow: '0 6px 18px rgba(0,0,0,0.6)',
				zIndex: '999998',
				opacity: '0',
				transition: `opacity ${NOTE_PREVIEW_CONFIG.fadeMs}ms ease`,
				backdropFilter: 'blur(4px)',
				fontSize: '12px'
			});
			document.body.appendChild(this.tooltip);
		}
		// BEATMAP FETCHING
		async fetchAndParseBeatmap(beatmapId) {
			if (this.beatmapCache.has(beatmapId)) {
				return this.beatmapCache.get(beatmapId);
			}
			try {
				const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
				if (!response.ok) throw new Error('Failed to fetch beatmap');
				const osuFileContent = await response.text();
				const parsed = BeatmapParser.parseOsuContent(osuFileContent);
				debug.log('Beatmap parsed:', {
					notes: parsed.notes.length,
					cols: parsed.cols,
					bpm: parsed.bpm
				});
				this.beatmapCache.set(beatmapId, parsed);
				return parsed;
			} catch (error) {
				debug.warn('Failed to fetch beatmap:', error);
				return null;
			}
		}
		getCurrentBeatmapId() {
			const hashMatch = window.location.hash.match(/#\w+\/(\d+)/);
			if (hashMatch) return hashMatch[1];
			const timelineMatch = window.location.pathname.match(/\/discussion\/(\d+)\/timeline/);
			if (timelineMatch) return timelineMatch[1];
			const discussionMatch = window.location.pathname.match(/\/discussion\/(\d+)/);
			return discussionMatch ? discussionMatch[1] : null;
		}
		// SNAP DETECTION
		static SNAP_DIVISORS = [{
				divisor: 1,
				name: '1/1'
			},
			{
				divisor: 2,
				name: '1/2'
			},
			{
				divisor: 3,
				name: '1/3'
			},
			{
				divisor: 4,
				name: '1/4'
			},
			{
				divisor: 6,
				name: '1/6'
			},
			{
				divisor: 8,
				name: '1/8'
			},
			{
				divisor: 12,
				name: '1/12'
			},
			{
				divisor: 16,
				name: '1/16'
			}
		];
		calculateSnap(time, times) {
			const sortedTimes = [...new Set(times)].sort((a, b) => a - b);
			if (sortedTimes.length < 2) return 'default';
			const intervals = [];
			for (let i = 1; i < sortedTimes.length; i++) {
				intervals.push(sortedTimes[i] - sortedTimes[i - 1]);
			}
			const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
			const minDist = 5;
			for (const snap of NotePreviewHandler.SNAP_DIVISORS) {
				const expectedInterval = avgInterval * snap.divisor;
				const dist = Math.abs(time % expectedInterval);
				if (dist < minDist || Math.abs(expectedInterval - dist) < minDist) {
					return snap.name;
				}
			}
			return 'default';
		}
		// CANVAS RENDERING
		createCanvas(allNotes, highlightedTimestamps, cols) {
			const dpr = window.devicePixelRatio || 1;
			const width = NOTE_PREVIEW_CONFIG.canvasWidth;
			const height = NOTE_PREVIEW_CONFIG.canvasHeight;
			const canvas = document.createElement('canvas');
			canvas.width = width * dpr;
			canvas.height = height * dpr;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			const ctx = canvas.getContext('2d');
			ctx.scale(dpr, dpr);
			// Background
			ctx.fillStyle = 'rgba(12,12,12,0.95)';
			ctx.fillRect(0, 0, width, height);
			if (!allNotes?.length) {
				this.drawEmptyState(ctx, width, height, 'No notes found');
				return canvas;
			}
			cols = cols || 4;
			const colWidth = width / cols;
			this.drawColumnDividers(ctx, cols, colWidth, height);
			this.drawReceptorLine(ctx, width, height);
			const {
				minTime,
				maxTime,
				notesInView
			} = this.calculateViewRange(
				allNotes,
				highlightedTimestamps,
				height
			);
			if (!notesInView.length) {
				this.drawEmptyState(ctx, width, height, 'No notes in view');
				return canvas;
			}
			this.drawNotes(ctx, notesInView, highlightedTimestamps, cols, colWidth,
				minTime, maxTime, width, height);
			return canvas;
		}
		drawEmptyState(ctx, width, height, message) {
			ctx.fillStyle = 'rgba(255,255,255,0.3)';
			ctx.font = '12px sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText(message, width / 2, height / 2);
		}
		drawColumnDividers(ctx, cols, colWidth, height) {
			ctx.strokeStyle = 'rgba(255,255,255,0.06)';
			ctx.lineWidth = 1;
			for (let i = 1; i < cols; i++) {
				const x = i * colWidth;
				ctx.beginPath();
				ctx.moveTo(x, 20);
				ctx.lineTo(x, height - 40);
				ctx.stroke();
			}
		}
		drawReceptorLine(ctx, width, height) {
			ctx.strokeStyle = 'rgba(255,255,255,0.1)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(0, height - 40);
			ctx.lineTo(width, height - 40);
			ctx.stroke();
		}
		calculateViewRange(allNotes, highlightedTimestamps, height) {
			let minTime, maxTime;
			if (highlightedTimestamps.size > 0) {
				const highlightedNotes = allNotes.filter(n => highlightedTimestamps.has(n.time));
				if (!highlightedNotes.length) {
					return {
						minTime: 0,
						maxTime: 0,
						notesInView: []
					};
				}
				const times = highlightedNotes.map(n => n.time);
				const endTimes = highlightedNotes.map(n =>
					(n.len && n.len > 0) ? n.time + n.len : n.time
				);
				minTime = Math.min(...times);
				maxTime = Math.max(...endTimes);
				const padding = Math.max((maxTime - minTime) * 0.3, 500);
				minTime -= padding;
				maxTime += padding;
			} else {
				const times = allNotes.map(n => n.time);
				const endTimes = allNotes.map(n =>
					(n.len && n.len > 0) ? n.time + n.len : n.time
				);
				minTime = Math.min(...times);
				maxTime = Math.max(...endTimes);
			}
			const notesInView = allNotes.filter(n => {
				const endTime = (n.len && n.len > 0) ? n.time + n.len : n.time;
				return n.time >= minTime && endTime <= maxTime;
			});
			return {
				minTime,
				maxTime,
				notesInView
			};
		}
		drawNotes(ctx, notes, highlightedTimestamps, cols, colWidth, minTime, maxTime, width, height) {
			const range = Math.max(1, maxTime - minTime);
			const times = notes.map(n => n.time);
			const highlightedSnaps = new Set(
				notes
				.filter(n => highlightedTimestamps.size === 0 || highlightedTimestamps.has(n.time))
				.map(n => this.calculateSnap(n.time, times))
			);
			const useUniformColor = highlightedSnaps.size === 1;
			const yFor = (time) => {
				const pct = (time - minTime) / range;
				return height - 50 - pct * (height - 80);
			};
			notes.forEach(n => {
				const col = Utils.clamp(n.col || 0, 0, cols - 1);
				const x = col * colWidth + 4;
				const w = colWidth - 8;
				const y = yFor(n.time);
				const isHighlighted = highlightedTimestamps.size === 0 ||
					highlightedTimestamps.has(n.time);
				const snap = this.calculateSnap(n.time, times);
				const baseColor = useUniformColor && isHighlighted ?
					'#ffffff' :
					(NOTE_PREVIEW_CONFIG.snapColors[snap] ||
						NOTE_PREVIEW_CONFIG.snapColors.default);
				const color = isHighlighted ? baseColor : 'rgba(80, 80, 80, 0.25)';
				const strokeColor = isHighlighted ? '#fff' : 'rgba(80, 80, 80, 0.4)';
				const strokeWidth = isHighlighted ? 2.5 : 0.8;
				if (n.len && n.len > 0) {
					this.drawLongNote(ctx, x, w, y, yFor(n.time + n.len),
						isHighlighted, baseColor, color, strokeWidth);
				}
				this.drawNoteHead(ctx, x, w, y, color, strokeColor,
					strokeWidth, isHighlighted);
			});
		}
		drawLongNote(ctx, x, w, yStart, yEnd, isHighlighted, baseColor, color, strokeWidth) {
			const h = Math.abs(yEnd - yStart);
			const y = Math.min(yStart, yEnd);
			if (isHighlighted) {
				const gradient = ctx.createLinearGradient(x, y, x, y + h);
				gradient.addColorStop(0, baseColor + 'AA');
				gradient.addColorStop(0.5, baseColor + '66');
				gradient.addColorStop(1, baseColor + 'AA');
				ctx.fillStyle = gradient;
			} else {
				ctx.fillStyle = 'rgba(60, 60, 60, 0.12)';
			}
			ctx.fillRect(x, y, w, h);
			ctx.strokeStyle = color;
			ctx.lineWidth = strokeWidth;
			ctx.strokeRect(x, y, w, h);
			if (isHighlighted && h > 16) {
				ctx.fillStyle = baseColor + '33';
				const stripeCount = Math.floor(h / 12);
				for (let i = 1; i < stripeCount; i++) {
					const stripeY = y + (i * h / stripeCount);
					ctx.fillRect(x + 1, stripeY, w - 2, 2);
				}
			}
			ctx.fillStyle = color;
			ctx.fillRect(x, y, w, 3);
			ctx.fillRect(x, y + h - 3, w, 3);
		}
		drawNoteHead(ctx, x, w, y, color, strokeColor, strokeWidth, isHighlighted) {
			ctx.fillStyle = color;
			ctx.fillRect(x, y - 7, w, 14);
			ctx.strokeStyle = strokeColor;
			ctx.lineWidth = isHighlighted ? 2 : 1;
			ctx.strokeRect(x, y - 7, w, 14);
			if (isHighlighted) {
				ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
				ctx.fillRect(x + 2, y - 5, w - 4, 10);
			}
		}
		// PREVIEW MANAGEMENT
		async showPreview(link, event) {
			if (!NOTE_PREVIEW_CONFIG.enabled) return;
			if (!link?.href) return;
			if (!location.pathname.includes('/discussion')) return;
			if (this.hoverTimer) clearTimeout(this.hoverTimer);
			this.hoverTimer = setTimeout(async () => {
				const beatmapId = this.getCurrentBeatmapId();
				if (!beatmapId) {
					debug.warn('No beatmap ID found');
					return;
				}
				const beatmapData = await this.fetchAndParseBeatmap(beatmapId);
				if (!beatmapData) {
					debug.warn('Failed to load beatmap data');
					return;
				}
				const pattern = BeatmapParser.parsePattern(link.href);
				debug.log(`Showing preview: ${pattern.timestamps.size} highlighted of ${beatmapData.notes.length} total`);
				this.renderPreview(beatmapData, pattern, event, link);
			}, NOTE_PREVIEW_CONFIG.hoverDelayMs);
		}
		renderPreview(beatmapData, pattern, event, link) {
			this.tooltip.innerHTML = '';
			const canvas = this.createCanvas(
				beatmapData.notes,
				pattern.timestamps,
				beatmapData.cols
			);
			this.tooltip.appendChild(canvas);
			const info = this.createInfoElement(beatmapData, pattern);
			this.tooltip.appendChild(info);
			this.tooltip.style.display = 'block';
			void this.tooltip.offsetWidth; // Force reflow
			this.tooltip.style.opacity = '1';
			this.currentTarget = {
				link,
				lastEvent: event
			};
			this.updatePosition(event);
		}
		createInfoElement(beatmapData, pattern) {
			const highlightedNotes = beatmapData.notes.filter(n =>
				pattern.timestamps.has(n.time)
			);
			const lnCount = highlightedNotes.filter(n => n.len && n.len > 0).length;
			const riceCount = highlightedNotes.length - lnCount;
			const totalLNs = beatmapData.notes.filter(n => n.len && n.len > 0).length;
			const info = Utils.createElement('div');
			Object.assign(info.style, {
				marginTop: '8px',
				textAlign: 'center',
				opacity: '0.7',
				fontSize: '11px'
			});
			info.textContent = `${beatmapData.cols}K • ${riceCount} rice • ${lnCount} LN ` +
				`(${highlightedNotes.length}/${beatmapData.notes.length} notes, ${totalLNs} LNs total)`;
			return info;
		}
		updatePosition(event) {
			if (!this.tooltip || !event) return;
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const rect = this.tooltip.getBoundingClientRect();
			let left = event.clientX + NOTE_PREVIEW_CONFIG.offsetX;
			let top = event.clientY + NOTE_PREVIEW_CONFIG.offsetY;
			if (left + rect.width > vw - 10) {
				left = event.clientX - NOTE_PREVIEW_CONFIG.offsetX - rect.width;
			}
			if (top + rect.height > vh - 10) {
				top = event.clientY - NOTE_PREVIEW_CONFIG.offsetY - rect.height;
			}
			this.tooltip.style.left = Math.max(10, left) + 'px';
			this.tooltip.style.top = Math.max(10, top) + 'px';
		}
		hidePreview() {
			if (this.hoverTimer) {
				clearTimeout(this.hoverTimer);
				this.hoverTimer = null;
			}
			this.currentTarget = null;
			this.tooltip.style.opacity = '0';
			setTimeout(() => {
				if (this.tooltip.style.opacity === '0') {
					this.tooltip.style.display = 'none';
				}
			}, NOTE_PREVIEW_CONFIG.fadeMs);
		}
		// LINK ATTACHMENT
		attachToLinks() {
			const observer = new MutationObserver(() => {
				if (!location.pathname.includes('/discussion')) return;
				this.attachEventListeners();
			});
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			if (location.pathname.includes('/discussion')) {
				this.attachEventListeners();
			}
		}
		attachEventListeners() {
			const links = document.querySelectorAll('a[href*="osu://edit"]');
			links.forEach(link => {
				if (link.dataset.notePreviewAttached) return;
				link.dataset.notePreviewAttached = '1';
				link.addEventListener('mouseenter', (e) => this.showPreview(link, e), {
					passive: true
				});
				link.addEventListener('mousemove', (e) => {
					if (this.currentTarget) this.updatePosition(e);
				}, {
					passive: true
				});
				link.addEventListener('mouseleave', () => this.hidePreview(), {
					passive: true
				});
			});
		}
	}
	// BROWSER MANAGER
	class BrowserManager {
		static PANEL_ID = 'browser-panel';
		static SEARCH_ENGINES = {
			song: [{
					name: 'Google',
					icon: 'fab fa-google',
					url: (q) => `https://www.google.com/search?q=${q}`
				},
				{
					name: 'YouTube',
					icon: 'fab fa-youtube',
					color: '#ff0000',
					url: (q) => `https://www.youtube.com/results?search_query=${q}`
				},
				{
					name: 'Spotify',
					icon: 'fab fa-spotify',
					color: '#1db954',
					url: (q) => `https://open.spotify.com/search/${q}`
				},
				{
					name: 'Apple Music',
					icon: 'fab fa-apple',
					url: (q) => `https://music.apple.com/search?term=${q}`
				},
				{
					name: 'SoundCloud',
					icon: 'fab fa-soundcloud',
					color: '#ff5500',
					url: (q) => `https://soundcloud.com/search?q=${q}`
				},
				{
					name: 'Niconico',
					icon: 'fas fa-video',
					url: (q) => `https://www.nicovideo.jp/search/${q}`
				},
				{
					name: 'VocaDB',
					icon: 'fas fa-music',
					url: (q) => `https://vocadb.net/search?filter=${q}`
				},
				{
					name: 'Discogs',
					icon: 'fas fa-compact-disc',
					url: (q) => `https://www.discogs.com/search/?q=${q}&type=release`
				}
			],
			artist: [{
					name: 'Google',
					icon: 'fab fa-google',
					url: (q) => `https://www.google.com/search?q=${q} music artist`
				},
				{
					name: 'YouTube',
					icon: 'fab fa-youtube',
					color: '#ff0000',
					url: (q) => `https://www.youtube.com/results?search_query=${q}`
				},
				{
					name: 'Spotify',
					icon: 'fab fa-spotify',
					color: '#1db954',
					url: (q) => `https://open.spotify.com/search/${q}`
				},
				{
					name: 'VocaDB',
					icon: 'fas fa-music',
					url: (q) => `https://vocadb.net/search?filter=${q}`
				},
				{
					name: 'Discogs',
					icon: 'fas fa-compact-disc',
					url: (q) => `https://www.discogs.com/search/?q=${q}&type=artist`
				},
				{
					name: 'SoundCloud',
					icon: 'fab fa-soundcloud',
					color: '#ff5500',
					url: (q) => `https://soundcloud.com/search?q=${q}`
				}
			],
			source: [{
					name: 'Google',
					icon: 'fab fa-google',
					url: (q) => `https://www.google.com/search?q=${q}`
				},
				{
					name: 'MyAnimeList',
					icon: 'fas fa-film',
					url: (q) => `https://myanimelist.net/search/all?q=${q}`
				},
				{
					name: 'AniList',
					icon: 'fas fa-tv',
					url: (q) => `https://anilist.co/search/anime?search=${q}`
				},
				{
					name: 'VNDB',
					icon: 'fas fa-gamepad',
					url: (q) => `https://vndb.org/v/all?sq=${q}`
				},
				{
					name: 'YouTube',
					icon: 'fab fa-youtube',
					color: '#ff0000',
					url: (q) => `https://www.youtube.com/results?search_query=${q}`
				},
				{
					name: 'IMDb',
					icon: 'fas fa-film',
					url: (q) => `https://www.imdb.com/find?q=${q}`
				}
			],
			mapper: [{
					name: 'osu! Profile',
					icon: 'fas fa-user',
					url: (q) => `https://osu.ppy.sh/users/${q}`
				},
				{
					name: 'Modding History',
					icon: 'fas fa-comment-dots',
					url: (q) => `https://osu.ppy.sh/users/${q}/modding`
				},
				{
					name: 'Beatmaps',
					icon: 'fas fa-map',
					url: (q) => `https://osu.ppy.sh/beatmapsets?q=${q}`
				},
				{
					name: 'Google',
					icon: 'fab fa-google',
					url: (q) => `https://www.google.com/search?q=${q} osu`
				}
			]
		};
		static async openBrowser() {
			const beatmapId = this.getCurrentBeatmapId();
			if (!beatmapId) {
				UI.showNotification('No beatmap detected', 'error');
				return;
			}
			UI.showNotification('Loading beatmap info...', 'info', 2000);
			try {
				const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
				if (!response.ok) throw new Error('Failed to fetch');
				const osuContent = await response.text();
				const metadata = this.parseMetadata(osuContent);
				this.showBrowserPanel(metadata);
			} catch (error) {
				debug.error('Failed to load beatmap:', error);
				UI.showNotification('Failed to load beatmap info', 'error');
			}
		}
		static getCurrentBeatmapId() {
			const hashMatch = window.location.hash.match(/#\w+\/(\d+)/);
			if (hashMatch) return hashMatch[1];
			const timelineMatch = window.location.pathname.match(/\/discussion\/(\d+)\/timeline/);
			if (timelineMatch) return timelineMatch[1];
			const discussionMatch = window.location.pathname.match(/\/discussion\/(\d+)/);
			return discussionMatch ? discussionMatch[1] : null;
		}
		static parseMetadata(osuContent) {
			const lines = osuContent.split('\n');
			const metadata = {
				artist: '',
				title: '',
				creator: '',
				source: ''
			};
			let inMetadata = false;
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed === '[Metadata]') {
					inMetadata = true;
					continue;
				}
				if (trimmed.startsWith('[') && inMetadata) break;
				if (inMetadata) {
					const [key, ...valueParts] = trimmed.split(':');
					const value = valueParts.join(':').trim();
					const keyLower = key.toLowerCase();
					if (keyLower === 'artist') metadata.artist = value;
					else if (keyLower === 'title') metadata.title = value;
					else if (keyLower === 'creator') metadata.creator = value;
					else if (keyLower === 'source') metadata.source = value;
				}
			}
			return metadata;
		}
		static showBrowserPanel(metadata) {
			let panel = document.getElementById(this.PANEL_ID);
			if (panel) panel.remove();
			panel = this.createPanel(metadata);
			document.body.appendChild(panel);
			this.setupEventListeners(panel);
		}
		static createPanel(metadata) {
			const panel = Utils.createElement('div');
			panel.id = this.PANEL_ID;
			panel.className = 'floating-panel';
			panel.style.cssText = `
            width: 340px;
            max-height: 600px;
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            z-index: 10002;
            overflow-y: auto;
        `;
			panel.innerHTML = `
            ${this.createCloseButton()}
            <div style="padding: 14px; padding-top: 40px; background: rgba(20, 20, 20, 0.95);">
                ${this.createHeader(metadata)}
                ${this.createTabs(metadata)}
                ${this.createTabContents(metadata)}
            </div>
        `;
			return panel;
		}
		static createCloseButton() {
			return `<button class="panel-close" style="position: absolute; top: 8px; right: 8px; background: none;
            border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px;
            padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 10003;">×</button>`;
		}
		static createHeader(metadata) {
			return `
            <div style="text-align: center; margin-bottom: 16px;">
                <i class="fas fa-globe" style="font-size: 32px; color: rgba(255, 255, 255, 0.3); margin-bottom: 8px;"></i>
                <div style="font-size: 14px; color: #eee; font-weight: 600; margin-bottom: 4px;">
                    ${Utils.sanitizeHTML(metadata.title)}
                </div>
                <div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">
                    by ${Utils.sanitizeHTML(metadata.artist)}
                </div>
                <div style="font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-top: 2px;">
                    mapped by ${Utils.sanitizeHTML(metadata.creator)}
                </div>
                ${metadata.source ? `<div style="font-size: 10px; color: rgba(255, 255, 255, 0.4); margin-top: 2px;">
                    Source: ${Utils.sanitizeHTML(metadata.source)}
                </div>` : ''}
            </div>
        `;
		}
		static createTabs(metadata) {
			const tabs = [{
					id: 'song',
					label: 'Song'
				},
				{
					id: 'artist',
					label: 'Artist'
				},
				...(metadata.source ? [{
					id: 'source',
					label: 'Source'
				}] : []),
				{
					id: 'mapper',
					label: 'Mapper'
				}
			];
			return `
            <div style="display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                ${tabs.map((tab, i) => `
                    <button class="search-tab ${i === 0 ? 'active' : ''}" data-tab="${tab.id}"
                        style="flex: 1; background: rgba(${i === 0 ? '255, 255, 255, 0.1' : '26, 26, 26, 0.6'});
                        border: none; color: ${i === 0 ? '#fff' : 'rgba(255, 255, 255, 0.7)'};
                        padding: 8px 12px; cursor: pointer; font-size: 11px;
                        border-radius: 4px 4px 0 0; transition: all 0.15s ease;">
                        ${tab.label}
                    </button>
                `).join('')}
            </div>
        `;
		}
		static createTabContents(metadata) {
			const queries = {
				song: encodeURIComponent(`${metadata.artist} ${metadata.title}`),
				songTitle: encodeURIComponent(metadata.title),
				artist: encodeURIComponent(metadata.artist),
				source: metadata.source ? encodeURIComponent(metadata.source) : '',
				mapper: encodeURIComponent(metadata.creator)
			};
			return `
            ${this.createTabContent('song', queries.song, queries.songTitle, true)}
            ${this.createTabContent('artist', queries.artist)}
            ${metadata.source ? this.createTabContent('source', queries.source) : ''}
            ${this.createTabContent('mapper', queries.mapper)}
        `;
		}
		static createTabContent(type, query, altQuery = null, isActive = false) {
			const engines = this.SEARCH_ENGINES[type];
			if (!engines) return '';
			return `
            <div class="search-tab-content" data-content="${type}" style="display: ${isActive ? 'block' : 'none'};">
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;">
                    ${engines.map(engine => this.createSearchButton(engine, type === 'song' && engine.name === 'VocaDB' ? altQuery : query)).join('')}
                </div>
            </div>
        `;
		}
		static createSearchButton(engine, query) {
			const colorStyle = engine.color ? `color: ${engine.color};` : '';
			return `
            <button class="search-btn" data-url="${engine.url(query)}"
                style="background: rgba(26, 26, 26, 0.6); border: 1px solid rgba(255, 255, 255, 0.08);
                color: rgba(255, 255, 255, 0.7); padding: 8px 12px; border-radius: 4px; cursor: pointer;
                font-size: 11px; transition: all 0.15s ease; text-align: left; display: flex;
                align-items: center; gap: 8px;">
                <i class="${engine.icon}" style="font-size: 14px; ${colorStyle}"></i>
                <span>${engine.name}</span>
            </button>
        `;
		}
		static setupEventListeners(panel) {
			this.setupCloseButton(panel);
			this.setupTabSwitching(panel);
			this.setupSearchButtons(panel);
			this.setupDragging(panel);
		}
		static setupCloseButton(panel) {
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('click', () => panel.remove());
			closeBtn.addEventListener('mousedown', e => e.stopPropagation());
			closeBtn.addEventListener('mouseenter', () => {
				closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
				closeBtn.style.color = '#fff';
			});
			closeBtn.addEventListener('mouseleave', () => {
				closeBtn.style.background = 'none';
				closeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
			});
		}
		static setupTabSwitching(panel) {
			const tabs = panel.querySelectorAll('.search-tab');
			const contents = panel.querySelectorAll('.search-tab-content');
			tabs.forEach(tab => {
				tab.addEventListener('click', () => {
					const targetTab = tab.dataset.tab;
					tabs.forEach(t => {
						t.style.background = 'rgba(26, 26, 26, 0.6)';
						t.style.color = 'rgba(255, 255, 255, 0.7)';
						t.classList.remove('active');
					});
					contents.forEach(c => {
						c.style.display = c.dataset.content === targetTab ? 'block' : 'none';
					});
					tab.style.background = 'rgba(255, 255, 255, 0.1)';
					tab.style.color = '#fff';
					tab.classList.add('active');
				});
				tab.addEventListener('mouseenter', () => {
					if (!tab.classList.contains('active')) {
						tab.style.background = 'rgba(255, 255, 255, 0.05)';
					}
				});
				tab.addEventListener('mouseleave', () => {
					if (!tab.classList.contains('active')) {
						tab.style.background = 'rgba(26, 26, 26, 0.6)';
					}
				});
				tab.addEventListener('mousedown', e => e.stopPropagation());
			});
		}
		static setupSearchButtons(panel) {
			panel.querySelectorAll('.search-btn').forEach(btn => {
				btn.addEventListener('mouseenter', () => {
					btn.style.background = 'rgba(255, 255, 255, 0.12)';
					btn.style.color = '#fff';
				});
				btn.addEventListener('mouseleave', () => {
					btn.style.background = 'rgba(26, 26, 26, 0.6)';
					btn.style.color = 'rgba(255, 255, 255, 0.7)';
				});
				btn.addEventListener('click', e => {
					e.stopPropagation();
					window.open(btn.dataset.url, '_blank', 'noopener,noreferrer');
				});
				btn.addEventListener('mousedown', e => e.stopPropagation());
			});
		}
		static setupDragging(panel) {
			const header = panel.querySelector('[style*="padding: 14px"]');
			header.style.cursor = 'move';
			UI.makeDraggable(panel, header);
		}
	}
	// AUDIO ANALYZER
	class AudioAnalyzer {
		static audioCache = new Map();
		static currentAudio = new Map();
		static audioContext = null;
		static analyser = null;
		static animationFrame = null;
		static fftWorker = null;
		static abortController = null;
		static initWorker() {
			if (this.fftWorker) return;
			const workerCode = `
			self.onmessage = function(e) {
				const { samples, id } = e.data;
				const spectrum = performFFT(samples);
				self.postMessage({ spectrum, id });
			};
			function performFFT(samples) {
				const n = samples.length;
				const real = new Float32Array(n);
				const imag = new Float32Array(n);
				for (let i = 0; i < n; i++) {
					real[i] = samples[i];
				}
				// Bit reversal
				let j = 0;
				for (let i = 0; i < n - 1; i++) {
					if (i < j) {
						[real[i], real[j]] = [real[j], real[i]];
						[imag[i], imag[j]] = [imag[j], imag[i]];
					}
					let k = n >> 1;
					while (k <= j) {
						j -= k;
						k >>= 1;
					}
					j += k;
				}
				// FFT
				for (let len = 2; len <= n; len <<= 1) {
					const halfLen = len >> 1;
					for (let i = 0; i < n; i += len) {
						for (let j = 0; j < halfLen; j++) {
							const angle = -2 * Math.PI * j / len;
							const wr = Math.cos(angle);
							const wi = Math.sin(angle);
							const k = i + j;
							const l = k + halfLen;
							const tReal = wr * real[l] - wi * imag[l];
							const tImag = wr * imag[l] + wi * real[l];
							real[l] = real[k] - tReal;
							imag[l] = imag[k] - tImag;
							real[k] += tReal;
							imag[k] += tImag;
						}
					}
				}
				// Magnitude
				const spectrum = new Float32Array(n / 2);
				for (let i = 0; i < n / 2; i++) {
					spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
				}
				return spectrum;
			}
		`;
			const blob = new Blob([workerCode], {
				type: 'application/javascript'
			});
			this.fftWorker = new Worker(URL.createObjectURL(blob));
		}
		static cancelAnalysis() {
			if (this.abortController) {
				this.abortController.abort();
				this.abortController = null;
			}
		}
		static async loadBeatmapAudio(beatmapsetId) {
			if (this.audioCache.has(beatmapsetId)) {
				debug.log('Using memory cached audio for', beatmapsetId);
				return this.audioCache.get(beatmapsetId);
			}
			try {
				const cached = await this.getFromIndexedDB(beatmapsetId);
				if (cached) {
					debug.log('Using IndexedDB cached audio');
					this.audioCache.set(beatmapsetId, cached);
					return cached;
				}
			} catch (e) {
				debug.warn('IndexedDB cache check failed:', e);
			}
			try {
				const cached = this.getFromLocalStorage(beatmapsetId);
				if (cached) {
					debug.log('Using localStorage cached audio (migrating to IndexedDB)');
					await this.saveToIndexedDB(beatmapsetId, cached.data, cached.filename);
					localStorage.removeItem(`audio_cache_${beatmapsetId}`);
					this.audioCache.set(beatmapsetId, cached);
					return cached;
				}
			} catch (e) {
				debug.warn('localStorage cache check failed:', e);
			}
			throw new Error('NO_AUDIO');
		}
		static getFromLocalStorage(beatmapsetId) {
			const key = `audio_cache_${beatmapsetId}`;
			const stored = localStorage.getItem(key);
			if (!stored) return null;
			try {
				const parsed = JSON.parse(stored);
				const now = Date.now();
				const thirtyDays = 30 * 24 * 60 * 60 * 1000;
				if (now - parsed.timestamp > thirtyDays) {
					localStorage.removeItem(key);
					return null;
				}
				const binaryString = atob(parsed.data);
				const bytes = new Uint8Array(binaryString.length);
				for (let i = 0; i < binaryString.length; i++) {
					bytes[i] = binaryString.charCodeAt(i);
				}
				return {
					data: bytes.buffer,
					filename: parsed.filename
				};
			} catch (e) {
				debug.warn('Failed to parse cached audio:', e);
				localStorage.removeItem(key);
				return null;
			}
		}
		static saveToLocalStorage(beatmapsetId, audioData, filename) {
			try {
				const key = `audio_cache_${beatmapsetId}`;
				const bytes = new Uint8Array(audioData);
				let binary = '';
				const chunkSize = 0x8000;
				for (let i = 0; i < bytes.length; i += chunkSize) {
					binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
				}
				const base64 = btoa(binary);
				const cached = {
					data: base64,
					filename: filename,
					timestamp: Date.now()
				};
				localStorage.setItem(key, JSON.stringify(cached));
				debug.log('Audio cached to localStorage');
			} catch (e) {
				debug.warn('Failed to cache audio (localStorage full?):', e);
			}
		}
		static async loadFromFile(file, beatmapsetId) {
			const arrayBuffer = await file.arrayBuffer();
			const cached = {
				data: arrayBuffer,
				filename: file.name
			};
			this.audioCache.set(beatmapsetId, cached);
			try {
				await this.saveToIndexedDB(beatmapsetId, arrayBuffer, file.name);
			} catch (e) {
				debug.warn('IndexedDB save failed, trying localStorage:', e);
				this.saveToLocalStorage(beatmapsetId, arrayBuffer, file.name);
			}
			return cached;
		}
		static async initIndexedDB() {
			return new Promise((resolve, reject) => {
				const request = indexedDB.open('osuAudioCache', 2);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result);
				request.onupgradeneeded = (event) => {
					const db = event.target.result;
					if (!db.objectStoreNames.contains('audio')) {
						const objectStore = db.createObjectStore('audio', {
							keyPath: 'id'
						});
						objectStore.createIndex('timestamp', 'timestamp', {
							unique: false
						});
						debug.log('IndexedDB object store created');
					}
				};
			});
		}
		static async saveToIndexedDB(beatmapsetId, audioData, filename) {
			try {
				const db = await this.initIndexedDB();
				const transaction = db.transaction(['audio'], 'readwrite');
				const store = transaction.objectStore('audio');
				const data = {
					id: `audio_${beatmapsetId}`,
					beatmapsetId: beatmapsetId,
					data: audioData,
					filename: filename,
					timestamp: Date.now(),
					size: audioData.byteLength
				};
				await new Promise((resolve, reject) => {
					const request = store.put(data);
					request.onsuccess = () => resolve();
					request.onerror = () => reject(request.error);
				});
				db.close();
				debug.log(`Audio cached to IndexedDB (${(audioData.byteLength / 1024 / 1024).toFixed(2)} MB)`);
			} catch (e) {
				debug.error('Failed to cache audio to IndexedDB:', e);
				throw e;
			}
		}
		static async getFromIndexedDB(beatmapsetId) {
			try {
				const db = await this.initIndexedDB();
				const transaction = db.transaction(['audio'], 'readonly');
				const store = transaction.objectStore('audio');
				const data = await new Promise((resolve, reject) => {
					const request = store.get(`audio_${beatmapsetId}`);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				db.close();
				if (!data) return null;
				const now = Date.now();
				const ninetyDays = 90 * 24 * 60 * 60 * 1000;
				if (now - data.timestamp > ninetyDays) {
					debug.log('Cached audio expired, deleting...');
					await this.deleteFromIndexedDB(beatmapsetId);
					return null;
				}
				return {
					data: data.data,
					filename: data.filename
				};
			} catch (e) {
				debug.warn('Failed to get audio from IndexedDB:', e);
				return null;
			}
		}
		static async deleteFromIndexedDB(beatmapsetId) {
			try {
				const db = await this.initIndexedDB();
				const transaction = db.transaction(['audio'], 'readwrite');
				const store = transaction.objectStore('audio');
				await new Promise((resolve, reject) => {
					const request = store.delete(`audio_${beatmapsetId}`);
					request.onsuccess = () => resolve();
					request.onerror = () => reject(request.error);
				});
				db.close();
				debug.log('Deleted audio from IndexedDB');
			} catch (e) {
				debug.warn('Failed to delete from IndexedDB:', e);
			}
		}
		static async getCacheStats() {
			try {
				const db = await this.initIndexedDB();
				const transaction = db.transaction(['audio'], 'readonly');
				const store = transaction.objectStore('audio');
				const allData = await new Promise((resolve, reject) => {
					const request = store.getAll();
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				db.close();
				const totalSize = allData.reduce((sum, item) => sum + (item.size || 0), 0);
				const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
				return {
					count: allData.length,
					totalSize: totalSize,
					totalSizeMB: totalSizeMB,
					items: allData.map(item => ({
						beatmapsetId: item.beatmapsetId,
						filename: item.filename,
						size: (item.size / 1024 / 1024).toFixed(2) + ' MB',
						cached: new Date(item.timestamp).toLocaleString()
					}))
				};
			} catch (e) {
				debug.error('Failed to get cache stats:', e);
				return {
					count: 0,
					totalSize: 0,
					totalSizeMB: '0',
					items: []
				};
			}
		}
		static async clearAllCache() {
			try {
				const db = await this.initIndexedDB();
				const transaction = db.transaction(['audio'], 'readwrite');
				const store = transaction.objectStore('audio');
				await new Promise((resolve, reject) => {
					const request = store.clear();
					request.onsuccess = () => resolve();
					request.onerror = () => reject(request.error);
				});
				db.close();
				for (let i = localStorage.length - 1; i >= 0; i--) {
					const key = localStorage.key(i);
					if (key && key.startsWith('audio_cache_')) {
						localStorage.removeItem(key);
					}
				}
				this.audioCache.clear();
				debug.log('All audio cache cleared');
				return true;
			} catch (e) {
				debug.error('Failed to clear cache:', e);
				return false;
			}
		}
		static async initAudioContext(audioData) {
			if (this.audioContext) {
				this.audioContext.close();
			}
			this.audioContext = new(window.AudioContext || window.webkitAudioContext)();
			const decodedData = await this.audioContext.decodeAudioData(audioData.slice(0));
			return decodedData;
		}
		static async createSpectrogram(container, audioBuffer, audioData) {
			const WIDTH = 700;
			const HEIGHT = 320;
			container.innerHTML = `
			<div style="background: rgba(0, 0, 0, 0.95); border-radius: 4px; padding: 0; position: relative;">
				<div style="position: relative;">
					<canvas id="audio-spectrogram" width="${WIDTH}" height="${HEIGHT}" style="display: block; background: #000; border-radius: 4px 4px 0 0; cursor: crosshair;"></canvas>
					<div id="spectrogram-progress" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.9); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10;">
						<div style="font-size: 14px; color: #fff; margin-bottom: 12px;">
							<i class="fas fa-spinner fa-spin"></i> Analyzing Audio...
						</div>
						<div style="width: 80%; background: rgba(255, 255, 255, 0.1); height: 6px; border-radius: 3px; overflow: hidden;">
							<div id="progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #6bb6ff, #4caf50); transition: width 0.3s ease;"></div>
						</div>
						<div id="progress-text" style="font-size: 11px; color: rgba(255, 255, 255, 0.7); margin-top: 8px;">0%</div>
						<button id="cancel-analysis" style="margin-top: 12px; background: rgba(255, 107, 107, 0.2); border: 1px solid rgba(255, 107, 107, 0.4); color: #ff6b6b; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 10px;">Cancel</button>
					</div>
					<div id="audio-hover-line" style="position: absolute; top: 0; left: 0; width: 1px; height: ${HEIGHT}px; background: rgba(255, 255, 255, 0.6); pointer-events: none; display: none;"></div>
					<div id="audio-playback-line" style="position: absolute; top: 0; left: 0; width: 2px; height: ${HEIGHT}px; background: rgba(255, 255, 255, 0.9); pointer-events: none; box-shadow: 0 0 10px rgba(255, 255, 255, 0.8), 0 0 20px rgba(255, 255, 255, 0.4); display: none;"></div>
					<div id="audio-hover-info" style="position: absolute; top: 0; left: 0; background: rgba(0, 0, 0, 0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 10px; pointer-events: none; display: none;"></div>
				</div>
				<div style="padding: 12px; background: rgba(10, 10, 10, 0.95); border-top: 1px solid rgba(255, 255, 255, 0.1);">
					<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
						<button id="audio-play-btn" class="feature-btn" style="flex: 0 0 70px; padding: 8px; font-size: 11px;">Play</button>
						<button id="audio-stop-btn" class="feature-btn" style="flex: 0 0 70px; padding: 8px; font-size: 11px;">Stop</button>
						<span id="audio-time" style="font-size: 11px; color: rgba(255,255,255,0.8); font-family: 'Consolas', monospace; flex: 1; text-align: right;">${this.formatTime(0)} / ${this.formatTime(audioBuffer.duration * 1000)}</span>
					</div>
					<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
						<label style="font-size: 10px; color: rgba(255,255,255,0.6); min-width: 50px;">Volume:</label>
						<input type="range" id="audio-volume" min="0" max="100" value="50" style="flex: 1; height: 4px;">
						<span id="volume-display" style="font-size: 10px; color: rgba(255,255,255,0.6); min-width: 35px;">50%</span>
					</div>
				</div>
			</div>
		`;
			const canvas = container.querySelector('#audio-spectrogram');
			const ctx = canvas.getContext('2d');
			const progressOverlay = container.querySelector('#spectrogram-progress');
			const progressBar = container.querySelector('#progress-bar');
			const progressText = container.querySelector('#progress-text');
			const cancelBtn = container.querySelector('#cancel-analysis');
			this.abortController = new AbortController();
			cancelBtn.addEventListener('click', () => {
				this.cancelAnalysis();
				progressOverlay.style.display = 'none';
				UI.showNotification('Analysis cancelled', 'info');
			});
			const hoverLine = container.querySelector('#audio-hover-line');
			const hoverInfo = container.querySelector('#audio-hover-info');
			canvas.addEventListener('mouseenter', () => {
				hoverLine.style.display = 'block';
				hoverInfo.style.display = 'block';
			});
			canvas.addEventListener('mouseleave', () => {
				hoverLine.style.display = 'none';
				hoverInfo.style.display = 'none';
			});
			canvas.addEventListener('mousemove', (e) => {
				const rect = canvas.getBoundingClientRect();
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;
				hoverLine.style.left = x + 'px';
				const time = (x / WIDTH) * audioBuffer.duration;
				const freqRatio = 1 - (y / HEIGHT);
				const freq = 20 * Math.pow(22000 / 20, freqRatio);
				hoverInfo.style.left = (x + 10) + 'px';
				hoverInfo.style.top = (y - 20) + 'px';
				hoverInfo.textContent = `Time: ${this.formatTime(time * 1000)} | Freq: ${Math.round(freq)}Hz`;
				if (e.buttons === 1) {
					audioElement.currentTime = time;
				}
			});
			const panel = container.closest('.floating-panel');
			if (panel) {
				panel.style.width = '820px';
				panel.style.maxHeight = 'none';
				panel.style.height = 'auto';
				panel.style.cursor = 'default';
				const header = panel.querySelector('[style*="text-align: center"]');
				if (header) {
					header.style.cursor = 'move';
					UI.makeDraggable(panel, header);
				}
			}
			const blob = new Blob([audioData], {
				type: this.detectMimeType(audioData)
			});
			const url = URL.createObjectURL(blob);
			const audioElement = new Audio(url);
			audioElement.volume = 0.5;
			const source = this.audioContext.createMediaElementSource(audioElement);
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = 2048;
			this.analyser.smoothingTimeConstant = 0.8;
			source.connect(this.analyser);
			this.analyser.connect(this.audioContext.destination);
			this.currentAudio.set('main', audioElement);
			this.setupAudioControls(container, audioElement, audioBuffer);
			const qualityInfo = this.analyzeAudioQuality(audioBuffer, audioData);
			this.displayQualityInfo(container, qualityInfo);
			try {
				await this.drawSpectrogramProgressive(
					ctx,
					WIDTH,
					HEIGHT,
					audioElement,
					audioBuffer,
					(progress) => {
						progressBar.style.width = `${progress}%`;
						progressText.textContent = `${Math.round(progress)}%`;
					},
					this.abortController.signal
				);
				progressOverlay.style.display = 'none';
			} catch (error) {
				if (error.name === 'AbortError') {
					console.log('Analysis cancelled by user');
				} else {
					console.error('Spectrogram generation failed:', error);
					UI.showNotification('Failed to generate spectrogram', 'error');
				}
				progressOverlay.style.display = 'none';
			}
		}
		static async drawSpectrogramProgressive(ctx, width, height, audioElement, audioBuffer, onProgress, abortSignal) {
			const minFreq = 20;
			const maxFreq = 22050;
			const sampleRate = audioBuffer.sampleRate;
			const audioData = audioBuffer.getChannelData(0);
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, width, height);
			const fftSize = 2048;
			const hopSize = Math.floor(audioData.length / width);
			const window = new Float32Array(fftSize);
			for (let i = 0; i < fftSize; i++) {
				window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
			}
			const imageData = ctx.createImageData(width, height);
			const pixels = imageData.data;
			this.initWorker();
			const CHUNK_SIZE = 50;
			const totalChunks = Math.ceil(width / CHUNK_SIZE);
			for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
				if (abortSignal.aborted) {
					throw new DOMException('Analysis cancelled', 'AbortError');
				}
				const startX = chunkIdx * CHUNK_SIZE;
				const endX = Math.min(startX + CHUNK_SIZE, width);
				await this.processSpectrogramChunk(
					startX,
					endX,
					audioData,
					window,
					fftSize,
					hopSize,
					pixels,
					width,
					height,
					minFreq,
					maxFreq,
					sampleRate
				);
				ctx.putImageData(imageData, 0, 0);
				const progress = ((chunkIdx + 1) / totalChunks) * 100;
				onProgress(progress);
				await new Promise(resolve => setTimeout(resolve, 0));
			}
			this.drawFrequencyLabels(ctx, width, height, minFreq, maxFreq);
		}
		static async processSpectrogramChunk(startX, endX, audioData, window, fftSize, hopSize, pixels, width, height, minFreq, maxFreq, sampleRate) {
			const promises = [];
			for (let x = startX; x < endX; x++) {
				const offset = x * hopSize;
				const samples = new Float32Array(fftSize);
				for (let i = 0; i < fftSize && (offset + i) < audioData.length; i++) {
					samples[i] = audioData[offset + i] * window[i];
				}
				const promise = new Promise((resolve) => {
					const handler = (e) => {
						if (e.data.id === x) {
							this.fftWorker.removeEventListener('message', handler);
							resolve({
								x,
								spectrum: e.data.spectrum
							});
						}
					};
					this.fftWorker.addEventListener('message', handler);
					this.fftWorker.postMessage({
						samples,
						id: x
					});
				});
				promises.push(promise);
			}
			const results = await Promise.all(promises);
			results.forEach(({
				x,
				spectrum
			}) => {
				for (let y = 0; y < height; y++) {
					const pixelRatio = (height - y) / height;
					const freq = minFreq + (pixelRatio * (maxFreq - minFreq));
					const bin = Math.floor((freq / (sampleRate / 2)) * spectrum.length);
					if (bin < 0 || bin >= spectrum.length) continue;
					const mag = spectrum[bin];
					const db = 20 * Math.log10(Math.max(mag, 1e-10));
					const norm = Math.max(0, Math.min(1, (db + 100) / 100));
					const color = this.spectrogramColor(norm);
					const idx = (y * width + x) * 4;
					pixels[idx] = color.r;
					pixels[idx + 1] = color.g;
					pixels[idx + 2] = color.b;
					pixels[idx + 3] = 255;
				}
			});
		}
		static spectrogramColor(norm) {
			let r, g, b;
			if (norm < 0.02) {
				r = 0;
				g = 0;
				b = 0;
			} else if (norm < 0.10) {
				const t = (norm - 0.02) / 0.08;
				const intensity = Math.pow(t, 1.5) * 50;
				r = 0;
				g = 0;
				b = Math.floor(intensity);
			} else if (norm < 0.25) {
				const t = (norm - 0.10) / 0.15;
				const curve = Math.pow(t, 0.8);
				r = Math.floor(curve * 80);
				g = 0;
				b = 50 + Math.floor(curve * 130);
			} else if (norm < 0.40) {
				const t = (norm - 0.25) / 0.15;
				r = 80 + Math.floor(t * 100);
				g = Math.floor(t * 40);
				b = 180 + Math.floor(t * 75);
			} else if (norm < 0.55) {
				const t = (norm - 0.40) / 0.15;
				r = 180 + Math.floor(t * 75);
				g = Math.floor((1 - t) * 40);
				b = Math.floor((1 - t) * 255);
			} else if (norm < 0.70) {
				const t = (norm - 0.55) / 0.15;
				r = 255;
				g = Math.floor(t * 165);
				b = 0;
			} else if (norm < 0.85) {
				const t = (norm - 0.70) / 0.15;
				r = 255;
				g = 165 + Math.floor(t * 90);
				b = 0;
			} else {
				const t = (norm - 0.85) / 0.15;
				const whiteness = Math.pow(t, 0.6) * 255;
				r = 255;
				g = 255;
				b = Math.floor(whiteness);
			}
			return {
				r,
				g,
				b
			};
		}
		static drawFrequencyLabels(ctx, width, height, minFreq, maxFreq) {
			ctx.font = '10px Arial';
			ctx.textAlign = 'right';
			const labels = [20, 100, 500, 1000, 5000, 10000, 15000, 16500, 17500, 19000, 20500, 22000];
			for (const f of labels) {
				const pixelRatio = (f - minFreq) / (maxFreq - minFreq);
				const y = height - Math.floor(pixelRatio * height);
				if (y < 0 || y > height) continue;
				ctx.fillStyle = 'rgba(0,0,0,0.8)';
				ctx.fillRect(0, y - 9, 50, 16);
				ctx.fillStyle = '#ffffff';
				const label = f >= 1000 ? (f / 1000) + 'k' : f.toString();
				ctx.fillText(label + 'Hz', 47, y + 4);
			}
			const qualityCutoffs = [{
					freq: 15500,
					label: '~128kbps',
					color: 'rgba(255, 107, 107, 0.3)'
				},
				{
					freq: 16500,
					label: '~160kbps',
					color: 'rgba(255, 217, 61, 0.3)'
				},
				{
					freq: 17500,
					label: '~192kbps',
					color: 'rgba(107, 182, 255, 0.3)'
				}
			];
			qualityCutoffs.forEach(cutoff => {
				const pixelRatio = (cutoff.freq - minFreq) / (maxFreq - minFreq);
				const y = height - Math.floor(pixelRatio * height);
				if (y < 0 || y > height) return;
				ctx.strokeStyle = cutoff.color;
				ctx.lineWidth = 2;
				ctx.setLineDash([5, 3]);
				ctx.beginPath();
				ctx.moveTo(55, y);
				ctx.lineTo(width, y);
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.fillStyle = cutoff.color.replace('0.3', '0.8');
				ctx.textAlign = 'left';
				ctx.font = 'bold 9px Arial';
				ctx.fillText(cutoff.label, width - 70, y - 3);
			});
			ctx.textAlign = 'right';
		}
		static analyzeAudioQuality(audioBuffer, audioFileData) {
			const sampleRate = audioBuffer.sampleRate;
			const duration = audioBuffer.duration;
			const channels = audioBuffer.numberOfChannels;
			const header = new Uint8Array(audioFileData.slice(0, 12));
			let format = 'Unknown';
			if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
				format = 'MP3';
			} else if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) {
				format = 'MP3';
			} else if (header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
				format = 'OGG';
			} else if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
				format = 'WAV';
			} else if (header[0] === 0x66 && header[1] === 0x4C && header[2] === 0x61 && header[3] === 0x43) {
				format = 'FLAC';
			}
			const fileSizeKB = audioFileData.byteLength / 1024;
			const estimatedBitrate = Math.round((fileSizeKB * 8) / duration);
			const cutoffAnalysis = this.detectFrequencyCutoffProper(audioBuffer);
			let quality = 'Unknown';
			let issues = [];
			let confidence = 'High';
			if (format.includes('MP3')) {
				if (cutoffAnalysis.cutoff < 15500) {
					quality = '~96-128kbps';
					if (estimatedBitrate > 150) {
						issues.push('Possibly upconverted/bloated');
						confidence = 'Low';
					}
				} else if (cutoffAnalysis.cutoff < 16500) {
					quality = '~128kbps';
				} else if (cutoffAnalysis.cutoff < 17500) {
					quality = '~160kbps';
				} else if (cutoffAnalysis.cutoff < 19000) {
					quality = '~192kbps';
				} else if (cutoffAnalysis.cutoff < 20500) {
					quality = '~256kbps';
				} else {
					quality = '~320kbps';
				}
			} else if (format.includes('OGG')) {
				if (estimatedBitrate < 140) {
					quality = 'Q4 (~128-160kbps)';
				} else if (estimatedBitrate < 200) {
					quality = 'Q5 (~160-192kbps)';
				} else if (estimatedBitrate < 224) {
					quality = 'Q6 (~192-224kbps)';
					if (estimatedBitrate > 208) {
						issues.push('May exceed 208kbps Average (RC limit)');
					}
				} else {
					quality = 'High quality';
				}
			} else if (format.includes('FLAC')) {
				quality = 'Lossless';
			} else if (format.includes('WAV')) {
				quality = 'Uncompressed';
			}
			if (cutoffAnalysis.hasClipping) {
				issues.push('Clipping Detected');
				confidence = 'Medium';
			}
			if (format.includes('MP3') && cutoffAnalysis.cutoff < 16000 && estimatedBitrate > 180) {
				issues.push('Likely Transcoded');
				confidence = 'Low';
			}
			return {
				format,
				sampleRate,
				channels,
				duration,
				fileSize: (audioFileData.byteLength / (1024 * 1024)).toFixed(2) + ' MB',
				estimatedBitrate: estimatedBitrate + ' kbps',
				cutoffFrequency: Math.round(cutoffAnalysis.cutoff) + ' Hz',
				quality,
				issues,
				confidence
			};
		}
		static detectFrequencyCutoffProper(audioBuffer) {
			const audioData = audioBuffer.getChannelData(0);
			const sampleRate = audioBuffer.sampleRate;
			const samplePoints = 5;
			const cutoffs = [];
			let hasClipping = false;
			for (let s = 0; s < samplePoints; s++) {
				const offset = Math.floor((audioBuffer.length / (samplePoints + 1)) * (s + 1));
				const fftSize = 2048;
				const samples = new Float32Array(fftSize);
				for (let i = 0; i < fftSize && (offset + i) < audioData.length; i++) {
					const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
					samples[i] = audioData[offset + i] * window;
					if (Math.abs(audioData[offset + i]) >= 0.99) {
						hasClipping = true;
					}
				}
				const spectrum = this.performFFTSync(samples);
				let cutoff = sampleRate / 2;
				const threshold = 0.001;
				for (let i = spectrum.length - 1; i > spectrum.length / 2; i--) {
					if (spectrum[i] > threshold) {
						cutoff = (i / spectrum.length) * (sampleRate / 2);
						break;
					}
				}
				cutoffs.push(cutoff);
			}
			const avgCutoff = cutoffs.reduce((a, b) => a + b) / cutoffs.length;
			return {
				cutoff: avgCutoff,
				hasClipping
			};
		}
		static performFFTSync(samples) {
			const n = samples.length;
			const real = new Float32Array(n);
			const imag = new Float32Array(n);
			for (let i = 0; i < n; i++) {
				real[i] = samples[i];
			}
			let j = 0;
			for (let i = 0; i < n - 1; i++) {
				if (i < j) {
					[real[i], real[j]] = [real[j], real[i]];
					[imag[i], imag[j]] = [imag[j], imag[i]];
				}
				let k = n >> 1;
				while (k <= j) {
					j -= k;
					k >>= 1;
				}
				j += k;
			}
			for (let len = 2; len <= n; len <<= 1) {
				const halfLen = len >> 1;
				for (let i = 0; i < n; i += len) {
					for (let j = 0; j < halfLen; j++) {
						const angle = -2 * Math.PI * j / len;
						const wr = Math.cos(angle);
						const wi = Math.sin(angle);
						const k = i + j;
						const l = k + halfLen;
						const tReal = wr * real[l] - wi * imag[l];
						const tImag = wr * imag[l] + wi * real[l];
						real[l] = real[k] - tReal;
						imag[l] = imag[k] - tImag;
						real[k] += tReal;
						imag[k] += tImag;
					}
				}
			}
			const spectrum = new Float32Array(n / 2);
			for (let i = 0; i < n / 2; i++) {
				spectrum[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
			}
			return spectrum;
		}
		static displayQualityInfo(container, info) {
			const overlay = document.createElement('div');
			overlay.style.cssText = 'background: rgba(10, 10, 10, 0.95); border-top: 1px solid rgba(255, 255, 255, 0.15); padding: 10px 12px; font-size: 11px; font-family: "Consolas", monospace;';
			const issueList = info.issues.length > 0 ? info.issues.map(i => `<div style="color: #ffd93d; margin-top: 2px; font-size: 10px;">• ${i}</div>`).join('') : '';
			overlay.innerHTML = `
			<div style="display: flex; gap: 15px; flex-wrap: wrap; margin-bottom: 8px;">
				<div style="flex: 1; min-width: 80px;">
					<div style="color: rgba(255,255,255,0.5); font-size: 9px; margin-bottom: 2px;">FORMAT</div>
					<div style="color: #fff; font-weight: 600; font-size: 11px;">${info.format}</div>
				</div>
				<div style="flex: 1; min-width: 80px;">
					<div style="color: rgba(255,255,255,0.5); font-size: 9px; margin-bottom: 2px;">QUALITY</div>
					<div style="color: #6bb6ff; font-weight: 600; font-size: 11px;">${info.quality}</div>
				</div>
				<div style="flex: 1; min-width: 80px;">
					<div style="color: rgba(255,255,255,0.5); font-size: 9px; margin-bottom: 2px;">CONFIDENCE</div>
					<div style="color: ${info.confidence === 'High' ? '#4caf50' : info.confidence === 'Medium' ? '#ffd93d' : '#ff6b6b'}; font-weight: 600; font-size: 11px;">${info.confidence}</div>
				</div>
				<div style="flex: 1; min-width: 70px;">
					<div style="color: rgba(255,255,255,0.5); font-size: 9px; margin-bottom: 2px;">BITRATE</div>
					<div style="color: rgba(255,255,255,0.9); font-size: 10px;">${info.estimatedBitrate}</div>
				</div>
				<div style="flex: 1; min-width: 70px;">
					<div style="color: rgba(255,255,255,0.5); font-size: 9px; margin-bottom: 2px;">CUTOFF</div>
					<div style="color: rgba(255,255,255,0.9); font-size: 10px;">${info.cutoffFrequency}</div>
				</div>
				<div style="flex: 1; min-width: 70px;">
					<div style="color: rgba(255,255,255,0.5); font-size: 9px; margin-bottom: 2px;">RATE</div>
					<div style="color: rgba(255,255,255,0.9); font-size: 10px;">${info.sampleRate}Hz</div>
				</div>
				<div style="flex: 1; min-width: 60px;">
					<div style="color: rgba(255,255,255,0.5); font-size: 9px; margin-bottom: 2px;">SIZE</div>
					<div style="color: rgba(255,255,255,0.9); font-size: 10px;">${info.fileSize}</div>
				</div>
			</div>
			${issueList ? `<div style="padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08);">${issueList}</div>` : ''}
		`;
			container.appendChild(overlay);
		}
		static detectMimeType(arrayBuffer) {
			const header = new Uint8Array(arrayBuffer.slice(0, 4));
			if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) return 'audio/mpeg';
			if (header[0] === 0x4F && header[1] === 0x67 && header[2] === 0x67) return 'audio/ogg';
			if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46) return 'audio/wav';
			return 'audio/mpeg';
		}
		static setupAudioControls(container, audioElement, audioBuffer) {
			const playBtn = container.querySelector('#audio-play-btn');
			const stopBtn = container.querySelector('#audio-stop-btn');
			const volumeSlider = container.querySelector('#audio-volume');
			const volumeDisplay = container.querySelector('#volume-display');
			const timeDisplay = container.querySelector('#audio-time');
			playBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const playbackLine = container.querySelector('#audio-playback-line');
				if (audioElement.paused) {
					audioElement.play();
					playBtn.textContent = 'Pause';
					if (playbackLine) playbackLine.style.display = 'block';
				} else {
					audioElement.pause();
					playBtn.textContent = 'Play';
					if (playbackLine) playbackLine.style.display = 'none';
				}
			});
			stopBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				audioElement.pause();
				audioElement.currentTime = 0;
				playBtn.textContent = 'Play';
				const playbackLine = container.querySelector('#audio-playback-line');
				if (playbackLine) playbackLine.style.display = 'none';
			});
			volumeSlider.addEventListener('input', (e) => {
				e.stopPropagation();
				audioElement.volume = e.target.value / 100;
				volumeDisplay.textContent = e.target.value + '%';
			});
			let detectedBPM = null;
			const canvasWidth = 700;
			audioElement.addEventListener('timeupdate', () => {
				const current = audioElement.currentTime * 1000;
				const total = audioBuffer.duration * 1000;
				timeDisplay.textContent = `${this.formatTime(current)} / ${this.formatTime(total)}`;
				const playbackLine = container.querySelector('#audio-playback-line');
				if (playbackLine) {
					const progress = (current / total) * canvasWidth;
					playbackLine.style.left = progress + 'px';
					playbackLine.style.display = audioElement.paused ? 'none' : 'block';
					if (!detectedBPM) {
						detectedBPM = this.detectBPM(audioBuffer) || 120;
						const beatDuration = (60 / detectedBPM) * 1000;
						playbackLine.style.animation = `playbackPulseBeat ${beatDuration}ms ease-in-out infinite`;
						debug.log('Detected BPM:', detectedBPM);
					}
				}
			});
			audioElement.addEventListener('play', () => {
				const playbackLine = container.querySelector('#audio-playback-line');
				if (playbackLine) {
					playbackLine.style.display = 'block';
				}
			});
			audioElement.addEventListener('pause', () => {
				const playbackLine = container.querySelector('#audio-playback-line');
				if (playbackLine) {
					playbackLine.style.display = 'none';
				}
			});
			audioElement.addEventListener('ended', () => {
				playBtn.textContent = 'Play';
			});
			[playBtn, stopBtn, volumeSlider].forEach(el => {
				el.addEventListener('mousedown', (e) => e.stopPropagation());
			});
		}
		static formatTime(ms) {
			const minutes = Math.floor(ms / 60000);
			const seconds = Math.floor((ms % 60000) / 1000);
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
		static detectBPM(audioBuffer) {
			try {
				const audioData = audioBuffer.getChannelData(0);
				const sampleRate = audioBuffer.sampleRate;
				const analyzeLength = Math.min(audioData.length, sampleRate * 30);
				const windowSize = Math.floor(sampleRate * 0.1);
				const energies = [];
				for (let i = 0; i < analyzeLength - windowSize; i += windowSize) {
					let energy = 0;
					for (let j = 0; j < windowSize; j++) {
						energy += Math.abs(audioData[i + j]);
					}
					energies.push(energy / windowSize);
				}
				const threshold = energies.reduce((a, b) => a + b) / energies.length * 1.5;
				const peaks = [];
				for (let i = 1; i < energies.length - 1; i++) {
					if (energies[i] > threshold && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
						peaks.push(i);
					}
				}
				if (peaks.length < 2) return 120;
				const intervals = [];
				for (let i = 1; i < peaks.length; i++) {
					intervals.push(peaks[i] - peaks[i - 1]);
				}
				const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
				const bpm = Math.round((60 * 1000) / (avgInterval * windowSize / sampleRate * 1000));
				return Math.max(60, Math.min(bpm, 200));
			} catch (e) {
				return 120;
			}
		}
		static cleanup() {
			this.cancelAnalysis();
			if (this.animationFrame) {
				cancelAnimationFrame(this.animationFrame);
				this.animationFrame = null;
			}
			this.currentAudio.forEach((audio) => {
				audio.pause();
				audio.src = '';
			});
			this.currentAudio.clear();
			if (this.fftWorker) {
				this.fftWorker.terminate();
				this.fftWorker = null;
			}
			if (this.audioContext) {
				this.audioContext.close();
				this.audioContext = null;
			}
		}
	}
	// SECURE CREDENTIALS MANAGER
	class CredentialsManager {
		static STORAGE_KEY = 'osu_credentials_encrypted';
		static SESSION_KEY = 'osu_session_token';
		static ENCRYPTION_KEY = null;
		static async generateEncryptionKey() {
			if (this.ENCRYPTION_KEY) return this.ENCRYPTION_KEY;
			const fingerprint = [
				navigator.userAgent,
				navigator.language,
				navigator.hardwareConcurrency,
				screen.colorDepth,
				screen.width,
				screen.height,
				new Date().getTimezoneOffset(),
				navigator.platform
			].join('|');
			const encoder = new TextEncoder();
			const data = encoder.encode(fingerprint);
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);
			this.ENCRYPTION_KEY = await crypto.subtle.importKey(
				'raw',
				hashBuffer, {
					name: 'AES-GCM',
					length: 256
				},
				false,
				['encrypt', 'decrypt']
			);
			return this.ENCRYPTION_KEY;
		}
		static async encryptCredentials(username, password) {
			try {
				const key = await this.generateEncryptionKey();
				const encoder = new TextEncoder();
				const data = encoder.encode(JSON.stringify({
					username,
					password,
					timestamp: Date.now()
				}));
				const iv = crypto.getRandomValues(new Uint8Array(12));
				const encrypted = await crypto.subtle.encrypt({
						name: 'AES-GCM',
						iv: iv
					},
					key,
					data
				);
				const combined = new Uint8Array(iv.length + encrypted.byteLength);
				combined.set(iv, 0);
				combined.set(new Uint8Array(encrypted), iv.length);
				const base64 = btoa(String.fromCharCode(...combined));
				localStorage.setItem(this.STORAGE_KEY, base64);
				return true;
			} catch (error) {
				console.error('Encryption failed:', error);
				return false;
			}
		}
		static async decryptCredentials() {
			try {
				const stored = localStorage.getItem(this.STORAGE_KEY);
				if (!stored) return null;
				const key = await this.generateEncryptionKey();
				const combined = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
				const iv = combined.slice(0, 12);
				const encrypted = combined.slice(12);
				const decrypted = await crypto.subtle.decrypt({
						name: 'AES-GCM',
						iv: iv
					},
					key,
					encrypted
				);
				const decoder = new TextDecoder();
				const json = decoder.decode(decrypted);
				const credentials = JSON.parse(json);
				const thirtyDays = 30 * 24 * 60 * 60 * 1000;
				if (Date.now() - credentials.timestamp > thirtyDays) {
					this.clearCredentials();
					return null;
				}
				return {
					username: credentials.username,
					password: credentials.password
				};
			} catch (error) {
				console.error('Decryption failed:', error);
				return null;
			}
		}
		static clearCredentials() {
			localStorage.removeItem(this.STORAGE_KEY);
			localStorage.removeItem(this.SESSION_KEY);
			sessionStorage.removeItem(this.SESSION_KEY);
		}
		static hasCredentials() {
			return localStorage.getItem(this.STORAGE_KEY) !== null;
		}
		static async login(username, password) {
			return new Promise((resolve, reject) => {
				GM_xmlhttpRequest({
					method: 'POST',
					url: 'https://osu.ppy.sh/session',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'X-CSRF-Token': this.getCSRFToken(),
						'Accept': 'application/json'
					},
					data: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
					onload: (response) => {
						console.log('Login response status:', response.status);
						console.log('Login response headers:', response.responseHeaders);
						if (response.status === 200 || response.status === 204) {
							const setCookieHeaders = response.responseHeaders.match(/set-cookie:\s*([^\r\n]+)/gi);
							if (setCookieHeaders) {
								for (const header of setCookieHeaders) {
									if (header.includes('osu_session')) {
										const match = header.match(/osu_session=([^;]+)/);
										if (match) {
											const token = match[1];
											sessionStorage.setItem(this.SESSION_KEY, token);
											console.log('Session token extracted');
											resolve({
												success: true,
												token
											});
											return;
										}
									}
								}
							}
							const existingCookies = document.cookie;
							const sessionMatch = existingCookies.match(/osu_session=([^;]+)/);
							if (sessionMatch) {
								const token = sessionMatch[1];
								sessionStorage.setItem(this.SESSION_KEY, token);
								console.log('Using existing browser session');
								resolve({
									success: true,
									token
								});
								return;
							}
						}
						console.error('Login failed - no session found');
						reject(new Error(`Login failed: ${response.status}`));
					},
					onerror: (error) => {
						console.error('Login request error:', error);
						reject(error);
					},
					timeout: 10000
				});
			});
		}
		static getCSRFToken() {
			const meta = document.querySelector('meta[name="csrf-token"]');
			return meta ? meta.getAttribute('content') : '';
		}
		static async downloadBeatmap(beatmapsetId) {
			try {
				UI.showNotification('Downloading beatmap...', 'info');
				return new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: 'GET',
						url: `https://osu.ppy.sh/beatmapsets/${beatmapsetId}/download?noVideo=1`,
						responseType: 'arraybuffer',
						headers: {
							'Cookie': document.cookie,
							'Referer': window.location.href
						},
						onload: async (response) => {
							if (response.status === 200) {
								const arrayBuffer = response.response;
								const header = new Uint8Array(arrayBuffer.slice(0, 4));
								const isZip = header[0] === 0x50 && header[1] === 0x4B;
								if (!isZip) {
									UI.showNotification('Not logged in to osu!', 'warning');
									window.open('https://osu.ppy.sh/home', '_blank');
									reject(new Error('Not logged in'));
									return;
								}
								console.log('✓ Downloaded .osz file:', (arrayBuffer.byteLength / 1024 / 1024).toFixed(2), 'MB');
								UI.showNotification('Extracting audio...', 'info');
								try {
									await this.extractAudioFromOszDirect(arrayBuffer, beatmapsetId);
									UI.showNotification('✓ Audio cached!', 'success');
									resolve(true);
								} catch (extractError) {
									console.error('Extraction failed:', extractError);
									UI.showNotification('Extraction failed: ' + extractError.message, 'error');
									reject(extractError);
								}
							} else if (response.status === 401 || response.status === 403) {
								UI.showNotification('Please log in to osu!', 'warning');
								window.open('https://osu.ppy.sh/home', '_blank');
								reject(new Error('Not logged in'));
							} else {
								reject(new Error(`Download failed: ${response.status}`));
							}
						},
						onerror: reject,
						timeout: 60000
					});
				});
			} catch (error) {
				console.error('Download failed:', error);
				UI.showNotification('Download failed', 'error');
				throw error;
			}
		}
		static async extractAudioFromOszDirect(oszArrayBuffer, beatmapsetId) {
			console.log('Step 1: Manual ZIP parsing (bypassing JSZip)...');
			const view = new DataView(oszArrayBuffer);
			const decoder = new TextDecoder();
			let offset = 0;
			let audioData = null;
			let audioFilename = null;
			while (offset < oszArrayBuffer.byteLength - 30) {
				const signature = view.getUint32(offset, true);
				if (signature === 0x04034b50) { // Local file header
					const filenameLength = view.getUint16(offset + 26, true);
					const extraLength = view.getUint16(offset + 28, true);
					const compressedSize = view.getUint32(offset + 18, true);
					const compressionMethod = view.getUint16(offset + 8, true);
					const filenameBytes = new Uint8Array(oszArrayBuffer, offset + 30, filenameLength);
					const filename = decoder.decode(filenameBytes);
					console.log('Found file:', filename, 'size:', compressedSize, 'method:', compressionMethod);
					if (/\.(mp3|ogg)$/i.test(filename) && !filename.includes('/')) {
						audioFilename = filename;
						const dataOffset = offset + 30 + filenameLength + extraLength;
						if (compressionMethod === 0) {
							console.log('✓ Found uncompressed audio:', filename);
							audioData = oszArrayBuffer.slice(dataOffset, dataOffset + compressedSize);
						} else if (compressionMethod === 8) {
							console.log('✓ Found compressed audio:', filename, '- decompressing...');
							const uncompressedSize = view.getUint32(offset + 22, true);
							console.log('Compressed:', compressedSize, 'bytes → Uncompressed:', uncompressedSize, 'bytes');
							const compressedData = new Uint8Array(oszArrayBuffer, dataOffset, compressedSize);
							if (typeof pako !== 'undefined') {
								try {
									const decompressed = pako.inflateRaw(compressedData);
									audioData = decompressed.buffer;
									console.log('✓ Decompressed with inflateRaw:', audioData.byteLength, 'bytes');
								} catch (e1) {
									console.log('inflateRaw failed, trying inflate:', e1.message);
									try {
										const decompressed = pako.inflate(compressedData);
										audioData = decompressed.buffer;
										console.log('✓ Decompressed with inflate:', audioData.byteLength, 'bytes');
									} catch (e2) {
										console.error('Both decompression methods failed:', e2.message);
										throw new Error('Cannot decompress audio - file may be corrupted');
									}
								}
							} else {
								throw new Error('pako library not loaded - cannot decompress audio');
							}
						}
						break;
					}
					offset += 30 + filenameLength + extraLength + compressedSize;
				} else {
					offset++;
				}
			}
			if (!audioData || !audioFilename) {
				throw new Error('No audio file found in .osz');
			}
			console.log('Step 2: Audio extracted:', audioData.byteLength, 'bytes');
			const mimeType = audioFilename.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg';
			const fileObj = new File([audioData], audioFilename, {
				type: mimeType
			});
			console.log('✓ File object:', fileObj.size, 'bytes');
			console.log('Step 3: Caching...');
			await AudioAnalyzer.loadFromFile(fileObj, beatmapsetId);
			await new Promise(resolve => setTimeout(resolve, 2000));
			console.log('Step 4: Verifying...');
			const cached = await AudioAnalyzer.loadBeatmapAudio(beatmapsetId);
			console.log('✓ Verified:', cached.filename, cached.data.byteLength, 'bytes');
			return true;
		}
	}
	// ANALYSIS TOOLS MANAGER
	class AnalysisToolsManager {
		static PANEL_ID = 'analysis-tools-panel';
		static TABS = ['audio'];
		static getCurrentBeatmapsetId() {
			const match = window.location.pathname.match(/\/beatmapsets\/(\d+)/);
			return match ? match[1] : null;
		}
		static showToolsPanel() {
			const existingPanel = document.getElementById(this.PANEL_ID);
			if (existingPanel) {
				existingPanel.remove();
				return;
			}
			const panel = this.createPanel();
			document.body.appendChild(panel);
			this.setupEventListeners(panel);
		}
		static createPanel() {
			const panel = Utils.createElement('div');
			panel.id = this.PANEL_ID;
			panel.className = 'floating-panel';
			panel.style.cssText = 'width: 340px; max-height: 500px;';
			panel.innerHTML = `
            ${this.createCloseButton()}
            <div class="panel-content" style="padding-top: 20px;">
                ${this.createHeader()}
                ${this.createTabs()}
                ${this.createTabContents()}
            </div>
        `;
			const header = panel.querySelector('[style*="text-align: center"]');
			if (header) {
				header.style.cursor = 'move';
				UI.makeDraggable(panel, header);
			}
			return panel;
		}
		static createCloseButton() {
			return `<button class="panel-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 1;">×</button>`;
		}
		static createHeader() {
			return `<div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
            <i class="fas fa-tools"></i> Analysis Tools
        </div>`;
		}
		static createTabs() {
			const tabs = [{
				id: 'audio',
				label: 'Audio'
			}];
			return `<div style="display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
            ${tabs.map((tab, i) => `
                <button class="analysis-tab ${i === 0 ? 'active' : ''}" data-tab="${tab.id}"
                    style="flex: 1; background: rgba(${i === 0 ? '255, 255, 255, 0.1' : '26, 26, 26, 0.6'});
                    border: none; color: ${i === 0 ? '#fff' : 'rgba(255, 255, 255, 0.7)'};
                    padding: 8px 12px; cursor: pointer; font-size: 11px;
                    border-radius: 4px 4px 0 0; transition: all 0.15s ease;">
                    ${tab.label}
                </button>
            `).join('')}
        </div>`;
		}
		static createTabContents() {
			return `
            ${this.createAudioTab()}
        `;
		}
		static createAudioTab() {
			return `<div class="analysis-tab-content" data-content="audio" style="display: block;">
            <div id="audio-content" style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.5);">
                <i class="fas fa-music" style="font-size: 48px; margin-bottom: 12px; opacity: 0.3;"></i>
                <p>Click "Load Audio" to analyze</p>
                <button class="feature-btn" id="analyze-audio" style="margin-top: 12px; padding: 8px 16px;">Load Audio</button>
                <button class="feature-btn" id="upload-audio" style="margin-top: 8px; padding: 8px 16px; background: rgba(255, 255, 255, 0.05);">Upload New Audio</button>
                <button class="feature-btn" id="clear-audio-cache" style="margin-top: 8px; padding: 8px 16px; background: rgba(255, 255, 255, 0.05);">
                    <i class="fas fa-trash"></i> Clear All Cached Audio
                </button>
            </div>
        </div>`;
		}
		static setupEventListeners(panel) {
			this.setupCloseButton(panel);
			this.setupTabSwitching(panel);
			this.setupAudioButtons(panel);
		}
		static setupCloseButton(panel) {
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('click', () => panel.remove());
			closeBtn.addEventListener('mousedown', e => e.stopPropagation());
			closeBtn.addEventListener('mouseenter', () => {
				closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
				closeBtn.style.color = '#fff';
			});
			closeBtn.addEventListener('mouseleave', () => {
				closeBtn.style.background = 'none';
				closeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
			});
		}
		static setupTabSwitching(panel) {
			const tabs = panel.querySelectorAll('.analysis-tab');
			const contents = panel.querySelectorAll('.analysis-tab-content');
			tabs.forEach(tab => {
				tab.addEventListener('click', () => {
					const targetTab = tab.dataset.tab;
					tabs.forEach(t => {
						t.style.background = 'rgba(26, 26, 26, 0.6)';
						t.style.color = 'rgba(255, 255, 255, 0.7)';
						t.classList.remove('active');
					});
					contents.forEach(c => {
						c.style.display = c.dataset.content === targetTab ? 'block' : 'none';
					});
					tab.style.background = 'rgba(255, 255, 255, 0.1)';
					tab.style.color = '#fff';
					tab.classList.add('active');
				});
				tab.addEventListener('mousedown', e => e.stopPropagation());
			});
		}
		static setupAudioButtons(panel) {
			const audioBtn = panel.querySelector('#analyze-audio');
			if (audioBtn) {
				audioBtn.addEventListener('click', async () => {
					const beatmapsetId = this.getCurrentBeatmapsetId();
					if (!beatmapsetId) {
						UI.showNotification('No beatmapset detected', 'error');
						return;
					}
					try {
						const audioData = await AudioAnalyzer.loadBeatmapAudio(beatmapsetId);
						console.log('Audio loaded from cache, analyzing...');
						// Audio exists, analyze it
						this.analyzeAudio(panel);
					} catch (error) {
						console.log('Audio cache error:', error);
						if (error.message === 'NO_AUDIO') {
							UI.showNotification('Downloading beatmap to extract audio...', 'info');
							try {
								const success = await CredentialsManager.downloadBeatmap(beatmapsetId);
								if (success) {
									console.log('✓ Download and extraction complete');
									await new Promise(resolve => setTimeout(resolve, 500));
									this.analyzeAudio(panel);
								}
							} catch (downloadError) {
								console.error('Auto-download failed:', downloadError);
								this.showAudioUpload(panel.querySelector('#audio-content'), beatmapsetId, panel);
							}
						} else {
							throw error;
						}
					}
				});
				audioBtn.addEventListener('mousedown', e => e.stopPropagation());
			}
			const uploadBtn = panel.querySelector('#upload-audio');
			if (uploadBtn) {
				uploadBtn.addEventListener('click', () => {
					const match = window.location.pathname.match(/\/beatmapsets\/(\d+)/);
					if (match) {
						const container = panel.querySelector('#audio-content');
						this.showAudioUpload(container, match[1], panel);
					}
				});
				uploadBtn.addEventListener('mousedown', e => e.stopPropagation());
			}
			const clearCacheBtn = panel.querySelector('#clear-audio-cache');
			if (clearCacheBtn) {
				clearCacheBtn.addEventListener('click', async () => {
					const stats = await AudioAnalyzer.getCacheStats();
					if (confirm(`Clear all cached audio files?\n\nCurrently cached: ${stats.count} files (${stats.totalSizeMB} MB)\n\nThis will free up storage space.`)) {
						const success = await AudioAnalyzer.clearAllCache();
						UI.showNotification(
							success ? `Cleared ${stats.count} files (${stats.totalSizeMB} MB)` : 'Failed to clear cache',
							success ? 'success' : 'error'
						);
					}
				});
				clearCacheBtn.addEventListener('mousedown', e => e.stopPropagation());
			}
		}
		static async analyzeAudio(panel) {
			const match = window.location.pathname.match(/\/beatmapsets\/(\d+)/);
			if (!match) {
				UI.showNotification('No beatmapset detected', 'error');
				return;
			}
			const beatmapsetId = match[1];
			const container = panel.querySelector('#audio-content');
			container.innerHTML = this.createLoadingSpinner('Loading audio...');
			try {
				AudioAnalyzer.cleanup();
				const audioData = await AudioAnalyzer.loadBeatmapAudio(beatmapsetId);
				debug.log('Audio data loaded:', {
					hasData: !!audioData,
					dataType: audioData?.data?.constructor?.name,
					dataSize: audioData?.data?.byteLength,
					filename: audioData?.filename
				});
				UI.showNotification('Decoding audio...', 'info', 2000);
				const audioBuffer = await AudioAnalyzer.initAudioContext(audioData.data);
				AudioAnalyzer.createSpectrogram(container, audioBuffer, audioData.data);
				UI.showNotification('Audio loaded!', 'success');
			} catch (error) {
				if (error.message === 'NO_AUDIO') {
					this.showAudioUpload(container, beatmapsetId, panel);
				} else {
					debug.error('Audio analysis failed:', error);
					container.innerHTML = this.createErrorMessage('Failed to load audio', error.message);
					UI.showNotification('Failed to load audio', 'error');
				}
			}
		}
		static showAudioUpload(container, beatmapsetId, panel) {
			container.innerHTML = `
            <div style="padding: 20px;">
                <div style="text-align: center; margin-bottom: 16px;">
                    <i class="fas fa-upload" style="font-size: 48px; color: rgba(255,255,255,0.3); margin-bottom: 12px; display: block;"></i>
                    <div style="font-size: 13px; color: #eee; margin-bottom: 8px; font-weight: 600;">Upload Audio File</div>
                    <div style="font-size: 10px; color: rgba(255,255,255,0.5); line-height: 1.5;">
                        Upload the audio file from your osu! songs folder<br>or extract it from the .osz file
                    </div>
                </div>
                <div style="background: rgba(26, 26, 26, 0.6); border: 2px dashed rgba(255, 255, 255, 0.2); border-radius: 6px; padding: 20px; margin-bottom: 12px; text-align: center;">
                    <input type="file" id="audio-file-input" accept=".mp3,.ogg,.wav" style="display: none;">
                    <button id="audio-upload-btn" class="feature-btn" style="padding: 10px 20px; font-size: 12px;">
                        <i class="fas fa-file-audio"></i> Choose Audio File
                    </button>
                    <div style="font-size: 9px; color: rgba(255,255,255,0.4); margin-top: 8px;">Accepts: MP3, OGG, WAV</div>
                </div>
                <div style="background: rgba(107, 182, 255, 0.1); border: 1px solid rgba(107, 182, 255, 0.3); border-radius: 4px; padding: 10px;">
                    <div style="font-size: 10px; color: rgba(107, 182, 255, 1); margin-bottom: 6px;">
                        <i class="fas fa-info-circle"></i> How to find the audio file:
                    </div>
                    <div style="font-size: 9px; color: rgba(255,255,255,0.7); line-height: 1.4; margin-bottom: 8px;">
                        1. Open File Explorer and paste this path:<br>
                        <code style="background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 2px;">%LOCALAPPDATA%\\osu!\\Songs</code><br>
                        2. Search for folder starting with: <strong>${beatmapsetId}</strong><br>
                        3. Upload the .mp3/.ogg file (not hitsounds)
                    </div>
                    <button id="copy-folder-search" class="feature-btn" style="width: 100%; padding: 6px 10px; font-size: 10px; background: rgba(107, 182, 255, 0.2);">
                        <i class="fas fa-copy"></i> Copy "${beatmapsetId}" to Search
                    </button>
                </div>
                <div style="font-size: 9px; color: rgba(255,255,255,0.3); text-align: center; margin-top: 12px; font-style: italic;">
                    Audio will be cached for 30 days
                </div>
            </div>
        `;
			this.setupAudioUploadListeners(container, beatmapsetId);
		}
		static setupAudioUploadListeners(container, beatmapsetId) {
			const copyBtn = container.querySelector('#copy-folder-search');
			if (copyBtn) {
				copyBtn.addEventListener('click', e => {
					e.stopPropagation();
					navigator.clipboard.writeText(beatmapsetId)
						.then(() => UI.showNotification(`Copied "${beatmapsetId}" - paste in File Explorer search!`, 'success'))
						.catch(() => UI.showNotification('Failed to copy', 'error'));
				});
				copyBtn.addEventListener('mousedown', e => e.stopPropagation());
			}
			const fileInput = container.querySelector('#audio-file-input');
			const uploadBtn = container.querySelector('#audio-upload-btn');
			uploadBtn.addEventListener('click', e => {
				e.stopPropagation();
				fileInput.click();
			});
			[uploadBtn, fileInput].forEach(el => el.addEventListener('mousedown', e => e.stopPropagation()));
			fileInput.addEventListener('change', async e => {
				const file = e.target.files[0];
				if (!file) return;
				try {
					container.innerHTML = this.createLoadingSpinner('Processing audio...');
					const audioData = await AudioAnalyzer.loadFromFile(file, beatmapsetId);
					UI.showNotification('Decoding audio...', 'info', 2000);
					const audioBuffer = await AudioAnalyzer.initAudioContext(audioData.data);
					AudioAnalyzer.createSpectrogram(container, audioBuffer, audioData.data);
					UI.showNotification('Audio loaded and cached!', 'success');
				} catch (error) {
					debug.error('File upload failed:', error);
					container.innerHTML = this.createErrorMessage('Failed to load audio file', error.message, true);
					UI.showNotification('Failed to load audio', 'error');
				}
			});
		}
		static createLoadingSpinner(text = null) {
			return `<div style="text-align: center; padding: 40px;">
            <i class="fas fa-spinner fa-spin" style="font-size: 32px;"></i>
            ${text ? `<div style="margin-top: 12px; font-size: 11px; color: rgba(255,255,255,0.6);">${text}</div>` : ''}
        </div>`;
		}
		static createErrorMessage(message, details = null, showRetry = false) {
			return `<div style="text-align: center; padding: 40px; color: #ff6b6b;">
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
            <p>${message}</p>
            ${details ? `<p style="font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 8px;">${details}</p>` : ''}
            ${showRetry ? '<button class="feature-btn" onclick="location.reload()" style="margin-top: 12px;">Try Again</button>' : ''}
        </div>`;
		}
		static createSuccessMessage(message) {
			return `<div style="text-align: center; padding: 30px; color: #4caf50;">
            <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
            <p>${message}</p>
        </div>`;
		}
		static renderIssuesList(issues) {
			return `<div style="max-height: 350px; overflow-y: auto;">
            ${issues.map(issue => this.renderIssueCard(issue)).join('')}
        </div>`;
		}
		static renderIssueCard(issue) {
			const colors = {
				error: {
					bg: 'rgba(255, 107, 107, 0.2)',
					text: '#ff6b6b'
				},
				warning: {
					bg: 'rgba(255, 217, 61, 0.2)',
					text: '#ffd93d'
				},
				info: {
					bg: 'rgba(107, 182, 255, 0.2)',
					text: '#6bb6ff'
				}
			};
			const color = colors[issue.severity] || colors.info;
			return `<div class="violation-card" style="background: rgba(26, 26, 26, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 10px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-weight: 600; color: #eee; font-size: 11px;">${issue.type}</span>
                <span style="text-transform: uppercase; font-size: 9px; padding: 2px 5px; border-radius: 3px; font-weight: 600; background: ${color.bg}; color: ${color.text};">${issue.severity}</span>
            </div>
            <div style="color: rgba(255, 255, 255, 0.85); font-size: 11px; margin-bottom: 5px;">${issue.message}</div>
            ${issue.field ? `<div style="font-size: 10px; color: rgba(255, 255, 255, 0.4);"><strong>Field:</strong> ${issue.field}</div>` : ''}
        </div>`;
		}
		static renderHitsoundIssues(issues) {
			return `<div style="max-height: 350px; overflow-y: auto;">
            ${issues.map(issue => `
                <div class="violation-card" style="background: rgba(26, 26, 26, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 10px; margin-bottom: 8px;">
                    <div style="font-weight: 600; color: #eee; font-size: 11px; margin-bottom: 6px;">${issue.type}</div>
                    <div style="color: rgba(255, 255, 255, 0.85); font-size: 11px; margin-bottom: 5px;">${issue.message}</div>
                    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.5); font-family: 'Consolas', 'Monaco', monospace;">${RCCheckerManager.formatTime(issue.time)}</div>
                </div>
            `).join('')}
        </div>`;
		}
	}
	// NOTES MANAGER
	class NotesManager {
		static PANEL_ID = 'notes-manager-panel';
		static TABS = ['beatmap-notes', 'collab'];
		static showNotesPanel() {
			const existingPanel = document.getElementById(this.PANEL_ID);
			if (existingPanel) {
				existingPanel.remove();
				return;
			}
			const beatmapsetId = BeatmapNotesManager.getCurrentBeatmapsetId();
			if (!beatmapsetId) {
				UI.showNotification('No beatmapset detected', 'error');
				return;
			}
			const panel = this.createPanel(beatmapsetId);
			document.body.appendChild(panel);
			this.setupEventListeners(panel, beatmapsetId);
		}
		static createPanel(beatmapsetId) {
			const panel = Utils.createElement('div');
			panel.id = this.PANEL_ID;
			panel.className = 'floating-panel';
			panel.style.cssText = 'width: 340px; max-height: 500px;';
			const notesData = BeatmapNotesManager.getBeatmapNotes(beatmapsetId);
			const bookmarks = BookmarkManager.getBookmarks(beatmapsetId);
			panel.innerHTML = `
            <button class="panel-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 1;">×</button>
            <div class="panel-content" style="padding-top: 20px;">
                ${this.createHeader()}
                ${this.createTabs()}
                ${this.createBeatmapNotesTab(notesData)}
                ${this.createCollabTab()}
            </div>
        `;
			const header = panel.querySelector('[style*="text-align: center"]');
			UI.makeDraggable(panel, header);
			panel.querySelectorAll('input, textarea, button, select').forEach(el => {
				el.addEventListener('mousedown', e => e.stopPropagation());
				el.addEventListener('click', e => e.stopPropagation());
				el.addEventListener('focus', e => e.stopPropagation());
			});
			return panel;
		}
		static createHeader() {
			return `<div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
            <i class="fas fa-sticky-note"></i> Notes & Collab
        </div>`;
		}
		static createTabs() {
			const tabs = [{
					id: 'beatmap-notes',
					label: 'Notes'
				},
				{
					id: 'collab',
					label: 'Collab'
				},
			];
			return `<div style="display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
            ${tabs.map((tab, i) => `
                <button class="notes-tab ${i === 0 ? 'active' : ''}" data-tab="${tab.id}"
                    style="flex: 1; background: rgba(${i === 0 ? '255, 255, 255, 0.1' : '26,26,26,0.6'});
                    border: none; color: ${i === 0 ? '#fff' : 'rgba(255,255,255,0.7)'};
                    padding: 8px 12px; cursor: pointer; font-size: 11px;
                    border-radius: 4px 4px 0 0; transition: all 0.15s ease;">
                    ${tab.label}
                </button>
            `).join('')}
        </div>`;
		}
		static createBeatmapNotesTab(notesData) {
			return `<div class="notes-tab-content" data-content="beatmap-notes" style="display: block;">
            <div style="font-size: 10px; color: rgba(255,255,255,0.4); margin-bottom: 10px;">
                ${notesData.updated ? 'Saved: ' + new Date(notesData.updated).toLocaleString() : 'Not saved yet'}
            </div>
            <textarea id="beatmap-notes-textarea" placeholder="Type your notes for this beatmapset..."
                style="width: 100%; min-height: 300px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
                color: #fff; padding: 10px; border-radius: 4px; font-size: 12px; resize: vertical; box-sizing: border-box;">${notesData.content}</textarea>
            <div style="margin-top: 10px; display: flex; gap: 6px;">
                <button class="feature-btn" id="save-notes" style="flex: 1;">Save Notes</button>
                <button class="feature-btn" id="clear-notes" style="flex: 1;">Clear</button>
            </div>
        </div>`;
		}
		static createBookmarksTab(bookmarks, beatmapsetId) {
			return `<div class="notes-tab-content" data-content="bookmarks" style="display: none;">
            <div style="margin-bottom: 14px; display: flex; gap: 6px;">
                <input type="text" id="bookmark-note" placeholder="Note/comment..."
                    style="flex: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
                    color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                <button id="add-bookmark" class="feature-btn" style="flex: 0 0 80px; padding: 6px 10px;">Add Current</button>
            </div>
            <div style="max-height: 450px; overflow-y: auto;">
                ${bookmarks.length === 0 ? `
                    <div style="text-align: center; padding: 40px 20px; color: rgba(255,255,255,0.3); font-size: 11px; font-style: italic;">
                        No bookmarks yet. Use the preview player and click "Add Current" to save timestamps.
                    </div>
                ` : bookmarks.map(b => this.createBookmarkCard(b)).join('')}
            </div>
        </div>`;
		}
		static createBookmarkCard(bookmark) {
			return `<div class="bookmark-card" data-id="${bookmark.id}"
            style="background: rgba(26,26,26,0.6); border-radius: 4px; padding: 10px; margin-bottom: 8px; cursor: pointer;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="font-family: monospace; font-size: 11px; color: #6bb6ff;">${BookmarkManager.formatTime(bookmark.timestamp)}</span>
                <button class="delete-bookmark" data-id="${bookmark.id}"
                    style="background: none; border: none; color: rgba(255,107,107,0.7); cursor: pointer; font-size: 10px;">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            ${bookmark.note ? `<div style="color: rgba(255,255,255,0.85); font-size: 11px;">${Utils.sanitizeHTML(bookmark.note)}</div>` : ''}
            <div style="font-size: 9px; color: rgba(255,255,255,0.4);">${new Date(bookmark.created).toLocaleString()}</div>
        </div>`;
		}
		static createCollabTab() {
			if (CollabNotesManager.SERVER_IP) {
				return this.createConnectedCollabTab();
			}
			return this.createDisconnectedCollabTab();
		}
		static createConnectedCollabTab() {
			return `<div class="notes-tab-content" data-content="collab" style="display: none;">
            <div style="background: rgba(107,182,255,0.1); border: 1px solid rgba(107,182,255,0.3); border-radius: 4px; padding: 10px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-size: 11px; color: #6bb6ff; font-weight: 600;">
                        <i class="fas fa-users"></i> Active Users (<span id="active-user-count">0</span>)
                    </div>
                    <div style="font-size: 9px; color: rgba(255,255,255,0.4);">
                        <i class="fas fa-circle" style="font-size: 6px; color: #4caf50;"></i> Live
                    </div>
                </div>
                <div id="active-users-list" style="max-height: 150px; overflow-y: auto;">
                    <div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.3); font-size: 10px; font-style: italic;">
                        Loading users...
                    </div>
                </div>
            </div>
            <div style="background: rgba(${CollabNotesManager.isConnected ? '76,175,80' : '255,217,61'},0.15);
                border: 1px solid rgba(${CollabNotesManager.isConnected ? '76,175,80' : '255,217,61'},0.4);
                border-radius: 4px; padding: 8px; margin-bottom: 12px;">
                <div style="font-size: 10px; color: ${CollabNotesManager.isConnected ? '#4caf50' : '#ffd93d'}; text-align: center; margin-bottom: 6px;">
                    <i class="fas fa-${CollabNotesManager.isConnected ? 'wifi' : 'exclamation-triangle'}"></i>
                    ${CollabNotesManager.isConnected ? 'Connected' : 'Configured'}: ${CollabNotesManager.SERVER_IP}:${CollabNotesManager.SERVER_PORT}
                </div>
                <div style="display: flex; gap: 4px;">
                    <button id="test-connection-btn" class="feature-btn" style="flex: 1; padding: 4px 8px; font-size: 10px;">Test Connection</button>
                    <button id="disconnect-btn" class="feature-btn" style="flex: 1; padding: 4px 8px; font-size: 10px; background: rgba(255,107,107,0.2);">Disconnect</button>
                </div>
            </div>
            <div style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px;">
                <input type="text" id="collab-timestamp" placeholder="00:00:000"
                    style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
                    color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px; font-family: monospace;">
                <textarea id="collab-note-input" placeholder="Type your note..."
                    style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
                    color: #fff; padding: 8px 10px; border-radius: 4px; font-size: 11px; min-height: 60px; resize: vertical;"></textarea>
                <button id="add-collab-note" class="feature-btn" style="padding: 8px 10px;">Add Note</button>
            </div>
            <!-- Chat Section -->
<div style="background: rgba(107,182,255,0.1); border: 1px solid rgba(107,182,255,0.3); border-radius: 4px; padding: 10px; margin-bottom: 12px;">
    <div style="font-size: 11px; color: #6bb6ff; font-weight: 600; margin-bottom: 8px;">
        <i class="fas fa-comments"></i> Live Chat
    </div>
    <div id="collab-chat-messages" style="max-height: 150px; overflow-y: auto; margin-bottom: 8px; background: rgba(0,0,0,0.3); border-radius: 3px; padding: 6px;"></div>
    <div style="display: flex; gap: 4px;">
        <input type="text" id="chat-input" placeholder="Type a message..." style="flex: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
        <button id="send-chat" class="feature-btn" style="flex: 0 0 60px; padding: 6px 10px; font-size: 10px;">Send</button>
    </div>
</div>
<!-- Notes Section -->
<div style="font-size: 11px; color: #eee; font-weight: 600; margin-bottom: 8px;">
    <i class="fas fa-sticky-note"></i> Collaboration Notes
</div>
<div id="collab-notes-container" style="max-height: 250px; overflow-y: auto;"></div>
<!-- History Button -->
<button id="view-history" class="feature-btn" style="width: 100%; margin-top: 12px; padding: 6px 10px; font-size: 10px;">
    <i class="fas fa-history"></i> View Session History
</button>
        </div>`;
		}
		static createDisconnectedCollabTab() {
			return `<div class="notes-tab-content" data-content="collab" style="display: none;">
            <div style="text-align: center; padding: 40px 20px;">
                <i class="fas fa-plug" style="font-size: 48px; color: rgba(255, 255, 255, 0.2); margin-bottom: 12px; display: block;"></i>
                <div style="font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-bottom: 12px;">
                    Collab mode not connected
                </div>
                <input type="text" id="collab-server-ip" placeholder="26.x.x.x (RadminVPN IP)"
                    value="${localStorage.getItem('collab_server_ip') || ''}"
                    style="width: 100%; margin-bottom: 6px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
                    color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                <input type="text" id="collab-server-port" placeholder="Port (default: 3000)"
                    value="${localStorage.getItem('collab_server_port') || '3000'}"
                    style="width: 100%; margin-bottom: 8px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
                    color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                <button id="collab-connect-btn" class="feature-btn" style="width: 100%; padding: 8px;">Connect to Server</button>
                <div style="font-size: 9px; color: rgba(255, 255, 255, 0.4); margin-top: 8px; text-align: center; font-style: italic;">
                    Requires RadminVPN + Node.js server running
                </div>
            </div>
        </div>`;
		}
		static setupEventListeners(panel, beatmapsetId) {
			this.setupCloseButton(panel);
			this.setupTabSwitching(panel);
			this.setupBeatmapNotesActions(panel, beatmapsetId);
			this.setupCollabActions(panel);
		}
		static setupCloseButton(panel) {
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('click', () => panel.remove());
			closeBtn.addEventListener('mousedown', e => e.stopPropagation());
		}
		static setupTabSwitching(panel) {
			const tabs = panel.querySelectorAll('.notes-tab');
			const contents = panel.querySelectorAll('.notes-tab-content');
			tabs.forEach(tab => {
				tab.addEventListener('click', () => {
					const targetTab = tab.dataset.tab;
					tabs.forEach(t => {
						t.style.background = 'rgba(26, 26, 26, 0.6)';
						t.style.color = 'rgba(255, 255, 255, 0.7)';
						t.classList.remove('active');
					});
					contents.forEach(c => {
						c.style.display = c.dataset.content === targetTab ? 'block' : 'none';
					});
					tab.style.background = 'rgba(255, 255, 255, 0.1)';
					tab.style.color = '#fff';
					tab.classList.add('active');
				});
				tab.addEventListener('mousedown', e => e.stopPropagation());
			});
		}
		static setupBeatmapNotesActions(panel, beatmapsetId) {
			const saveBtn = panel.querySelector('#save-notes');
			const clearBtn = panel.querySelector('#clear-notes');
			const textarea = panel.querySelector('#beatmap-notes-textarea');
			saveBtn.addEventListener('click', () => {
				BeatmapNotesManager.saveBeatmapNotes(beatmapsetId, textarea.value);
				UI.showNotification('Notes saved', 'success');
			});
			clearBtn.addEventListener('click', () => {
				textarea.value = '';
				BeatmapNotesManager.saveBeatmapNotes(beatmapsetId, '');
				UI.showNotification('Notes cleared', 'info');
			});
		}
		static setupBookmarksActions(panel, beatmapsetId) {
			const addBtn = panel.querySelector('#add-bookmark');
			addBtn.addEventListener('click', e => {
				e.stopPropagation();
				const note = panel.querySelector('#bookmark-note').value.trim();
				const previewPlayer = window.beatmapPreviewInstance;
				if (!previewPlayer || !previewPlayer.currentTime) {
					UI.showNotification('Open preview player first', 'warning');
					return;
				}
				const bookmark = {
					timestamp: previewPlayer.currentTime,
					note: note
				};
				if (BookmarkManager.saveBookmark(beatmapsetId, bookmark)) {
					UI.showNotification('Bookmark added', 'success');
					this.refreshBookmarksTab(panel, beatmapsetId);
				}
			});
			panel.querySelectorAll('.delete-bookmark').forEach(btn => {
				btn.addEventListener('click', e => {
					e.stopPropagation();
					const id = parseInt(btn.dataset.id);
					if (confirm('Delete this bookmark?')) {
						BookmarkManager.deleteBookmark(beatmapsetId, id);
						UI.showNotification('Bookmark deleted', 'info');
						panel.remove();
						this.showNotesPanel();
					}
				});
			});
		}
		static refreshBookmarksTab(panel, beatmapsetId) {
			const container = panel.querySelector('[data-content="bookmarks"]');
			const bookmarks = BookmarkManager.getBookmarks(beatmapsetId);
			container.innerHTML = `
            <div style="margin-bottom: 14px; display: flex; gap: 6px;">
                <input type="text" id="bookmark-note" placeholder="Note/comment..."
                    style="flex: 1; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
                    color: #fff; padding: 6px 10px; border-radius: 4px; font-size: 11px;">
                <button id="add-bookmark" class="feature-btn" style="flex: 0 0 80px; padding: 6px 10px;">Add Current</button>
            </div>
            <div style="max-height: 450px; overflow-y: auto;">
                ${bookmarks.map(b => this.createBookmarkCard(b)).join('')}
            </div>
        `;
			this.setupEventListeners(panel, beatmapsetId);
		}
		static setupCollabActions(panel) {
			this.setupCollabConnectionTest(panel);
			this.setupCollabDisconnect(panel);
			this.setupCollabNoteInput(panel);
			this.setupCollabConnect(panel);
			this.setupHistoryViewer(panel);
			const chatInput = panel.querySelector('#chat-input');
			const sendBtn = panel.querySelector('#send-chat');
			if (chatInput && sendBtn) {
				[chatInput, sendBtn].forEach(el => {
					el.addEventListener('mousedown', e => e.stopPropagation());
					el.addEventListener('click', e => e.stopPropagation());
				});
				const sendMessage = () => {
					const text = chatInput.value.trim();
					if (text) {
						CollabNotesManager.sendChatMessage(text);
						chatInput.value = '';
						chatInput.focus();
					}
				};
				sendBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					sendMessage();
				});
				chatInput.addEventListener('keydown', (e) => {
					e.stopPropagation();
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						sendMessage();
					}
				});
			}
		}
		static setupCollabConnectionTest(panel) {
			const testBtn = panel.querySelector('#test-connection-btn');
			if (!testBtn) return;
			testBtn.addEventListener('click', e => {
				e.preventDefault();
				e.stopPropagation();
				UI.showNotification('Testing connection...', 'info');
				GM_xmlhttpRequest({
					method: 'GET',
					url: `http://${CollabNotesManager.SERVER_IP}:${CollabNotesManager.SERVER_PORT}/notes`,
					onload: response => {
						if (response.status >= 200 && response.status < 300) {
							try {
								const notes = JSON.parse(response.responseText);
								UI.showNotification(`✓ Server OK - ${notes.length} notes found`, 'success');
								if (CollabNotesManager.pollInterval) {
									UI.showNotification('✓ Polling active (updates every 3s)', 'success');
								} else {
									UI.showNotification('⚠ Polling not active', 'warning');
								}
							} catch (error) {
								UI.showNotification('✗ Invalid server response', 'error');
							}
						} else {
							UI.showNotification(`✗ Server returned ${response.status}`, 'error');
						}
					},
					onerror: () => UI.showNotification('✗ Connection failed', 'error'),
					timeout: 5000
				});
			});
		}
		static setupCollabDisconnect(panel) {
			const disconnectBtn = panel.querySelector('#disconnect-btn');
			if (!disconnectBtn) return;
			disconnectBtn.addEventListener('click', e => {
				e.preventDefault();
				e.stopPropagation();
				CollabNotesManager.stopPolling();
				CollabNotesManager.isConnected = false;
				localStorage.removeItem('collab_server_ip');
				localStorage.removeItem('collab_server_port');
				CollabNotesManager.SERVER_IP = '';
				UI.showNotification('Disconnected', 'info');
				panel.remove();
				setTimeout(() => this.showNotesPanel(), 100);
			});
		}
		static setupCollabNoteInput(panel) {
			const collabBtn = panel.querySelector('#add-collab-note');
			const collabInput = panel.querySelector('#collab-note-input');
			const collabTimestamp = panel.querySelector('#collab-timestamp');
			if (!collabBtn || !collabInput) return;
			const newCollabBtn = collabBtn.cloneNode(true);
			collabBtn.parentNode.replaceChild(newCollabBtn, collabBtn);
			newCollabBtn.addEventListener('click', async e => {
				e.preventDefault();
				e.stopPropagation();
				const note = collabInput.value.trim();
				if (!note) {
					UI.showNotification('Enter a note first', 'warning');
					return;
				}
				if (!CollabNotesManager.SERVER_IP) {
					UI.showNotification('Configure server first', 'error');
					return;
				}
				const timestamp = collabTimestamp?.value || '00:00:000';
				const username = localStorage.getItem('collab_username') ||
					prompt('Enter your username:');
				if (!localStorage.getItem('collab_username')) {
					localStorage.setItem('collab_username', username);
				}
				const noteData = {
					time: timestamp,
					author: username,
					text: note,
					resolved: false,
					created: Date.now()
				};
				await CollabNotesManager.addNote(noteData);
				const currentInput = document.querySelector('#collab-note-input');
				const currentTimestamp = document.querySelector('#collab-timestamp');
				if (currentInput) currentInput.value = '';
				if (currentTimestamp) currentTimestamp.value = '';
			});
		}
		static setupCollabConnect(panel) {
			const connectBtn = panel.querySelector('#collab-connect-btn');
			const ipInput = panel.querySelector('#collab-server-ip');
			const portInput = panel.querySelector('#collab-server-port');
			if (!connectBtn || !ipInput || !portInput) return;
			connectBtn.addEventListener('click', async e => {
				e.preventDefault();
				e.stopPropagation();
				const ip = ipInput.value.trim();
				const port = portInput.value.trim() || '3000';
				if (!ip) {
					UI.showNotification('Enter server IP address', 'warning');
					return;
				}
				localStorage.setItem('collab_server_ip', ip);
				localStorage.setItem('collab_server_port', port);
				CollabNotesManager.SERVER_IP = ip;
				CollabNotesManager.SERVER_PORT = port;
				UI.showNotification(`Connecting to ${ip}:${port}...`, 'info');
				await CollabNotesManager.init();
				setTimeout(() => {
					panel.remove();
					setTimeout(() => this.showNotesPanel(), 100);
				}, 1000);
			});
		}
		static setupHistoryViewer(panel) {
			const historyBtn = panel.querySelector('#view-history');
			if (!historyBtn) return;
			historyBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const history = await CollabNotesManager.fetchSessionHistory();
				const historyPanel = Utils.createElement('div');
				historyPanel.className = 'floating-panel';
				historyPanel.style.cssText = 'width: 340px; max-height: 500px;';
				historyPanel.innerHTML = `
			<button class="panel-close" style="position: absolute; top: 8px; right: 8px;">×</button>
			<div class="panel-content" style="padding-top: 20px;">
				<div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
					<i class="fas fa-history"></i> Session History
				</div>
				<div style="max-height: 400px; overflow-y: auto;">
					${CollabNotesManager.renderSessionHistory(history)}
				</div>
			</div>
		`;
				document.body.appendChild(historyPanel);
				UI.makeDraggable(historyPanel, historyPanel);
				const closeBtn = historyPanel.querySelector('.panel-close');
				closeBtn.addEventListener('click', () => historyPanel.remove());
				closeBtn.addEventListener('mousedown', e => e.stopPropagation());
			});
			historyBtn.addEventListener('mousedown', e => e.stopPropagation());
		}
		static setupPresetsActions(panel) {
			const addBtn = panel.querySelector('#add-preset-btn');
			const input = panel.querySelector('#new-preset-input');
			addBtn.addEventListener('click', () => {
				const value = input.value.trim();
				if (!value) return;
				PresetManager.addPreset(value);
				UI.showNotification('Preset added', 'success');
				input.value = '';
				panel.remove();
				this.showNotesPanel();
			});
			panel.querySelectorAll('.copy-preset').forEach(btn => {
				btn.addEventListener('click', () => {
					const index = parseInt(btn.dataset.index);
					const presets = PresetManager.getPresets();
					const preset = presets[index];
					const textarea = TextEditor.findActiveTextarea();
					if (textarea) {
						TextEditor.insertTextAtCursor(textarea, preset);
						UI.showNotification('Preset inserted!', 'success');
					} else {
						navigator.clipboard.writeText(preset);
						UI.showNotification('Preset copied!', 'success');
					}
				});
			});
			panel.querySelectorAll('.delete-preset').forEach(btn => {
				btn.addEventListener('click', () => {
					const index = parseInt(btn.dataset.index);
					if (confirm('Delete this preset?')) {
						PresetManager.deletePreset(index);
						UI.showNotification('Preset deleted', 'info');
						panel.remove();
						this.showNotesPanel();
					}
				});
			});
		}
	}
	// RC CHECKER
	class RCChecker {
		static thresholdCache = new Map();
		static checkMap(beatmapData) {
			const violations = [];
			const rules = BPMScaler.scaleRules(beatmapData.difficulty, beatmapData.bpm);
			if (!rules) return violations;
			this.checkSettings(beatmapData, rules, violations);
			const checks = [
				this.checkDensity,
				this.checkConsecutiveNotes,
				this.checkChords,
				this.checkLNLengths,
				this.checkLNGaps,
				this.checkLNHolds,
				this.checkAnchors,
				this.checkJacks,
				this.checkTrills,
				this.checkSplitJumptrills,
				this.checkShieldPatterns,
				this.checkLongStreams,
				this.checkBrackets,
				this.checkSplitRolls,
				this.check18Streams,
				this.checkLNStreams,
				this.checkGraceNotes,
				this.checkHandsInStreams
			];
			checks.forEach(check => violations.push(...check.call(this, beatmapData, rules)));
			return violations.sort((a, b) => (a.time || 0) - (b.time || 0));
		}
		// UTILITIES - OPTIMIZED
		static getSnapThreshold(bpm, snap) {
			const key = `${bpm}-${snap}`;
			if (this.thresholdCache.has(key)) return this.thresholdCache.get(key);
			const beatMs = 60000 / bpm;
			const divisors = {
				'1/1': 1,
				'1/2': 2,
				'1/3': 3,
				'1/4': 4,
				'1/6': 6,
				'1/8': 8,
				'1/12': 12,
				'1/16': 16
			};
			const result = beatMs / (divisors[snap] || 1);
			this.thresholdCache.set(key, result);
			return result;
		}
		static getChords(notes) {
			const timeMap = new Map();
			notes.forEach(n => {
				if (!timeMap.has(n.time)) timeMap.set(n.time, []);
				timeMap.get(n.time).push(n);
			});
			return Array.from(timeMap.entries())
				.filter(([_, notesList]) => notesList.length > 1)
				.map(([time, notesList]) => ({
					time: parseInt(time),
					cols: notesList.map(n => n.col).sort((a, b) => a - b),
					notes: notesList.map(n => n.id)
				}))
				.sort((a, b) => a.time - b.time);
		}
		static analyzePattern(notes, startIdx, count) {
			const section = notes.slice(startIdx, startIdx + count);
			if (section.length < 2) return {
				type: 'unknown',
				avgGap: 0
			};
			const cols = section.map(n => n.col);
			const uniqueCols = new Set(cols);
			let totalGap = 0;
			for (let i = 1; i < section.length; i++) {
				totalGap += section[i].time - section[i - 1].time;
			}
			const avgGap = totalGap / (section.length - 1);
			if (uniqueCols.size === 1) {
				return {
					type: 'jack',
					col: cols[0],
					avgGap
				};
			}
			if (uniqueCols.size === 2) {
				let isTrill = true;
				for (let i = 2; i < cols.length; i++) {
					if (cols[i] === cols[i - 1]) {
						isTrill = false;
						break;
					}
				}
				if (isTrill) return {
					type: 'trill',
					cols: Array.from(uniqueCols),
					avgGap
				};
			}
			if (cols.length >= 4) {
				let isAscending = true,
					isDescending = true;
				for (let i = 1; i < cols.length; i++) {
					if (cols[i] !== cols[i - 1] + 1) isAscending = false;
					if (cols[i] !== cols[i - 1] - 1) isDescending = false;
				}
				if (isAscending || isDescending) {
					return {
						type: 'roll',
						direction: isAscending ? 'ascending' : 'descending',
						avgGap
					};
				}
			}
			const chords = this.getChords(section);
			if (chords.length >= 3 && chords.every(c => c.cols.length === 2)) {
				const chord1 = chords[0].cols.join(',');
				const chord2 = chords[1].cols.join(',');
				if (chord1 !== chord2) {
					let isSplitJumptrill = true;
					for (let i = 0; i < chords.length; i++) {
						const expected = i % 2 === 0 ? chord1 : chord2;
						if (chords[i].cols.join(',') !== expected) {
							isSplitJumptrill = false;
							break;
						}
					}
					if (isSplitJumptrill) {
						return {
							type: 'split-jumptrill',
							chord1: chords[0].cols,
							chord2: chords[1].cols,
							avgGap
						};
					}
				}
			}
			return {
				type: 'stream',
				uniqueCols: uniqueCols.size,
				avgGap
			};
		}
		// CHECKS
		static checkSettings(beatmapData, rules, violations) {
			const {
				hp,
				od,
				difficulty
			} = beatmapData;
			if (rules.hp && hp > rules.hp) {
				violations.push({
					type: 'HP Drain Rate',
					severity: 'error',
					message: `HP (${hp}) exceeds maximum (${rules.hp})`,
					time: null,
					rule: `${difficulty}: HP should not exceed ${rules.hp}`
				});
			}
			if (rules.od && od > rules.od) {
				violations.push({
					type: 'Overall Difficulty',
					severity: 'error',
					message: `OD (${od}) exceeds maximum (${rules.od})`,
					time: null,
					rule: `${difficulty}: OD should not exceed ${rules.od}`
				});
			}
		}
		static checkDensity(beatmapData, rules) {
			if (!rules.density) return [];
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			const violations = [];
			const windowSize = 10000;
			const threshold = difficulty === 'Easy' ? 0.3 : 0.5;
			const snapThreshold = this.getSnapThreshold(bpm, '1/4') * 1.1;
			const step = 50;
			for (let i = 0; i < notes.length; i += step) {
				const windowEnd = notes[i].time + windowSize;
				const windowNotes = [];
				for (let j = i; j < notes.length && notes[j].time < windowEnd; j++) {
					windowNotes.push(notes[j]);
				}
				if (windowNotes.length < 10) continue;
				let quarterCount = 0;
				for (let j = 1; j < windowNotes.length; j++) {
					if (windowNotes[j].time - windowNotes[j - 1].time < snapThreshold) {
						quarterCount++;
					}
				}
				const ratio = quarterCount / (windowNotes.length - 1);
				if (ratio > threshold) {
					violations.push({
						type: 'Density',
						severity: 'warning',
						message: `Too much 1/4 density (${Math.round(ratio * 100)}%) in this section`,
						time: notes[i].time,
						endTime: windowEnd,
						rule: `${difficulty}: ${rules.density}`
					});
					i += 100;
				}
			}
			return violations;
		}
		static checkConsecutiveNotes(beatmapData, rules) {
			if (!rules.consecutive) return [];
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			const {
				snap,
				limit
			} = rules.consecutive;
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, snap) * 1.15;
			const timestamps = [...new Set(notes.map(n => n.time))].sort((a, b) => a - b);
			let consecutiveCount = 1,
				startTime = timestamps[0];
			for (let i = 1; i < timestamps.length; i++) {
				if (timestamps[i] - timestamps[i - 1] < threshold) {
					consecutiveCount++;
				} else {
					if (consecutiveCount > limit) {
						violations.push({
							type: 'Consecutive',
							severity: 'warning',
							message: `${consecutiveCount} consecutive ${snap} ticks exceeds limit of ${limit}`,
							time: startTime,
							endTime: timestamps[i - 1],
							notes: notes.filter(n => n.time >= startTime && n.time <= timestamps[i - 1]),
							rule: `${difficulty}: Avoid using more than ${limit} consecutive ${snap} notes`
						});
					}
					consecutiveCount = 1;
					startTime = timestamps[i];
				}
			}
			return violations;
		}
		static checkAnchors(beatmapData, rules) {
			if (!rules.anchors) return [];
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			const maxLength = rules.anchors;
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, '1/2') * 1.2;
			const columns = new Map();
			notes.forEach(n => {
				if (!columns.has(n.col)) columns.set(n.col, []);
				columns.get(n.col).push(n);
			});
			columns.forEach((colNotes, col) => {
				let anchorLength = 1,
					startTime = colNotes[0].time,
					anchorNoteIds = [colNotes[0]];
				for (let i = 1; i < colNotes.length; i++) {
					if (colNotes[i].time - colNotes[i - 1].time < threshold) {
						anchorLength++;
						anchorNoteIds.push(colNotes[i]);
					} else {
						if (anchorLength > maxLength) {
							violations.push({
								type: 'Anchor',
								severity: 'warning',
								message: `Anchor of ${anchorLength} notes in column ${col + 1}`,
								time: startTime,
								endTime: colNotes[i - 1].time,
								notes: anchorNoteIds,
								rule: `${difficulty}: Avoid anchors with ${maxLength}+ notes`
							});
						}
						anchorLength = 1;
						startTime = colNotes[i].time;
						anchorNoteIds = [colNotes[i]];
					}
				}
			});
			return violations;
		}
		static checkLNLengths(beatmapData, rules) {
			if (!rules.longNoteMin) return [];
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			const violations = [];
			const beatLength = 60000 / bpm;
			const minMs = {
				"1 beat": beatLength,
				"1/2 beat": beatLength / 2,
				"1/4 beat": beatLength / 4
			} [rules.longNoteMin];
			if (!minMs) return [];
			notes.filter(n => n.isLN && n.length < minMs * 0.9).forEach(ln => {
				violations.push({
					type: 'LN Length',
					severity: 'error',
					message: `LN (${Math.round(ln.length)}ms) shorter than minimum (${Math.round(minMs)}ms)`,
					time: ln.time,
					notes: [ln.id],
					rule: `${difficulty}: LNs must be at least ${rules.longNoteMin}`
				});
			});
			return violations;
		}
		static checkLNGaps(beatmapData, rules) {
			if (!rules.longNoteGap) return [];
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			const violations = [];
			const beatLength = 60000 / bpm;
			const minMs = rules.longNoteGap === "1 beat" ? beatLength :
				rules.longNoteGap === "1/2 beat" ? beatLength / 2 : null;
			if (!minMs) return [];
			const releaseGroups = new Map();
			notes.filter(n => n.isLN).forEach(ln => {
				if (!releaseGroups.has(ln.endTime)) releaseGroups.set(ln.endTime, []);
				releaseGroups.get(ln.endTime).push(ln);
			});
			const releaseTimes = Array.from(releaseGroups.keys()).sort((a, b) => a - b);
			for (let i = 1; i < releaseTimes.length; i++) {
				const gap = releaseTimes[i] - releaseTimes[i - 1];
				if (gap > 0 && gap < minMs * 0.85) {
					violations.push({
						type: 'LN Release Gap',
						severity: 'warning',
						message: `LN release gap (${Math.round(gap)}ms) shorter than ${rules.longNoteGap}`,
						time: releaseTimes[i - 1],
						endTime: releaseTimes[i],
						notes: [...releaseGroups.get(releaseTimes[i - 1]), ...releaseGroups.get(releaseTimes[i])],
						rule: `${difficulty}: LN releases must be at least ${rules.longNoteGap} apart`
					});
				}
			}
			return violations;
		}
		static checkLNHolds(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			if (difficulty !== 'Easy' && difficulty !== 'Normal') return [];
			const violations = [];
			const threshold = (difficulty === 'Easy' ? 1 : 0.5) * 60000 / bpm * 1.1;
			notes.filter(n => n.isLN && n.length <= threshold).forEach(ln => {
				const overlapping = notes.filter(n =>
					!n.isLN && n.time > ln.time + 50 && n.time < ln.endTime - 50 && n.col !== ln.col
				);
				if (overlapping.length > 0) {
					violations.push({
						type: 'LN Hold Objects',
						severity: 'error',
						message: `${overlapping.length} object(s) during LN hold`,
						time: ln.time,
						notes: [ln.id, ...overlapping.map(n => n.id)],
						rule: `${difficulty}: No objects during short LN holds`
					});
				}
			});
			return violations;
		}
		static checkChords(beatmapData, rules) {
			const {
				notes,
				cs,
				difficulty
			} = beatmapData;
			const violations = [];
			const maxChordSize = {
				'Easy': 2,
				'Normal': cs === 4 ? 2 : 3,
				'Hard': cs === 4 ? 3 : 4,
				'Insane': cs === 4 ? 4 : 5,
				'Expert': cs
			} [difficulty];
			if (!maxChordSize) return [];
			this.getChords(notes).forEach(chord => {
				if (chord.cols.length > maxChordSize) {
					violations.push({
						type: 'Chord Size',
						severity: 'error',
						message: `${chord.cols.length}-note chord exceeds max of ${maxChordSize}`,
						time: chord.time,
						notes: chord.notes,
						rule: `${difficulty}: Max ${maxChordSize}-note chords`
					});
				}
			});
			return violations;
		}
		static checkTrills(beatmapData, rules) {
			if (!rules.trillLimit) return [];
			const {
				notes,
				difficulty
			} = beatmapData;
			const maxLength = rules.trillLimit;
			const violations = [];
			let trillStart = -1,
				trillLength = 0,
				trillNoteIds = [];
			for (let i = 0; i < notes.length; i++) {
				const pattern = this.analyzePattern(notes, i, Math.min(10, notes.length - i));
				if (pattern.type === 'trill') {
					if (trillStart === -1) {
						trillStart = i;
						trillNoteIds = [];
					}
					trillLength++;
					trillNoteIds.push(notes[i].id);
				} else {
					if (trillLength > maxLength) {
						violations.push({
							type: 'Trill',
							severity: 'warning',
							message: `${trillLength}-note trill exceeds ${maxLength}`,
							time: notes[trillStart].time,
							endTime: notes[i - 1].time,
							notes: trillNoteIds,
							rule: `${difficulty}: Max ${maxLength}-note trills`
						});
					}
					trillStart = -1;
					trillLength = 0;
					trillNoteIds = [];
				}
			}
			return violations;
		}
		static checkJacks(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, '1/4') * 1.1;
			const columns = new Map();
			notes.forEach(n => {
				if (!columns.has(n.col)) columns.set(n.col, []);
				columns.get(n.col).push(n);
			});
			columns.forEach((colNotes, col) => {
				let jackStart = -1,
					jackLength = 0,
					jackNoteIds = [];
				for (let i = 1; i < colNotes.length; i++) {
					if (colNotes[i].time - colNotes[i - 1].time < threshold) {
						if (jackStart === -1) {
							jackStart = i - 1;
							jackNoteIds = [colNotes[i - 1].id];
						}
						jackLength++;
						jackNoteIds.push(colNotes[i].id);
					} else {
						if (jackLength >= 1 &&
							((difficulty === 'Easy' || difficulty === 'Normal') ||
								(difficulty === 'Hard' && jackLength >= 2))) {
							violations.push({
								type: '1/4 Jack',
								severity: difficulty === 'Hard' ? 'warning' : 'error',
								message: `${jackLength + 1}-note 1/4 jack in column ${col + 1}`,
								time: colNotes[jackStart].time,
								endTime: colNotes[i - 1].time,
								notes: jackNoteIds,
								rule: `${difficulty}: ${difficulty === 'Hard' ? 'Extended jacks discouraged' : 'No 1/4 jacks allowed'}`
							});
						}
						jackStart = -1;
						jackLength = 0;
						jackNoteIds = [];
					}
				}
			});
			return violations;
		}
		static checkSplitJumptrills(beatmapData, rules) {
			if (!rules.splitJumptrillLimit) return [];
			return this.checkPatternLength(beatmapData, rules.splitJumptrillLimit, 'split-jumptrill', 'Split-Jumptrill');
		}
		static checkShieldPatterns(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			if (difficulty !== 'Normal') return [];
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, '1/4') * 2;
			notes.filter(n => n.isLN).forEach(ln => {
				const conflicting = notes.filter(n =>
					!n.isLN && n.col === ln.col && n.time > ln.time && n.time < ln.endTime && n.time - ln.time < threshold
				);
				if (conflicting.length > 0) {
					violations.push({
						type: 'Shield Pattern',
						severity: 'error',
						message: `Shield pattern detected (notes in held LN column)`,
						time: ln.time,
						notes: [ln.id, ...conflicting.map(n => n.id)],
						rule: `${difficulty}: No 1/4 shield patterns`
					});
				}
			});
			return violations;
		}
		static checkLongStreams(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			if (difficulty !== 'Normal' && difficulty !== 'Hard') return [];
			const violations = [];
			const snap = difficulty === 'Normal' ? '1/2' : '1/4';
			const threshold = this.getSnapThreshold(bpm, snap) * 1.15;
			const phraseLength = 4 * 60000 / bpm * 1.5;
			let lastBreak = 0;
			for (let i = 1; i < notes.length; i++) {
				if (notes[i].time - notes[i - 1].time < threshold) {
					if (notes[i].time - lastBreak > phraseLength) {
						violations.push({
							type: 'Long Stream',
							severity: 'warning',
							message: `Long ${snap} stream without break (${((notes[i].time - lastBreak) / 1000).toFixed(1)}s)`,
							time: lastBreak,
							endTime: notes[i].time,
							rule: `${difficulty}: Streams need breaks after musical phrases`
						});
						lastBreak = notes[i].time;
					}
				} else if (notes[i].time - notes[i - 1].time > this.getSnapThreshold(bpm, '1/1')) {
					lastBreak = notes[i].time;
				}
			}
			return violations;
		}
		static checkBrackets(beatmapData, rules) {
			const {
				cs,
				difficulty,
				notes
			} = beatmapData;
			if (difficulty !== 'Normal' || cs !== 7) return [];
			const violations = [];
			let bracketCount = 0;
			for (const chord of this.getChords(notes)) {
				if (chord.cols.length >= 2) {
					for (let i = 1; i < chord.cols.length; i++) {
						if (chord.cols[i] - chord.cols[i - 1] === 1 && ++bracketCount > 3) {
							violations.push({
								type: 'Bracket Pattern',
								severity: 'warning',
								message: `Excessive bracket patterns (adjacent columns in chords)`,
								time: chord.time,
								rule: `${difficulty} 7K: Use brackets sparingly`
							});
							return violations;
						}
					}
				}
			}
			return violations;
		}
		static checkSplitRolls(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			if (difficulty !== 'Insane' && difficulty !== 'Expert') return [];
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, '1/8') * 1.2;
			const maxDuration = difficulty === 'Insane' ? 4 * 60000 / bpm : Infinity;
			let rollStart = -1,
				noteIds = [];
			for (let i = 0; i < notes.length; i++) {
				const pattern = this.analyzePattern(notes, i, Math.min(8, notes.length - i));
				if (pattern.type === 'roll' && pattern.avgGap < threshold) {
					if (rollStart === -1) {
						rollStart = i;
						noteIds = [];
					}
					noteIds.push(notes[i].id);
				} else {
					if (rollStart !== -1 && notes[i - 1].time - notes[rollStart].time > maxDuration) {
						const duration = (notes[i - 1].time - notes[rollStart].time) / (60000 / bpm);
						violations.push({
							type: 'Split Roll',
							severity: 'warning',
							message: `1/8 split roll (${duration.toFixed(1)} beats) exceeds 4 beats`,
							time: notes[rollStart].time,
							endTime: notes[i - 1].time,
							notes: noteIds,
							rule: `${difficulty}: Max 4-beat split rolls`
						});
					}
					rollStart = -1;
					noteIds = [];
				}
			}
			return violations;
		}
		static check18Streams(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			if (difficulty !== 'Hard' && difficulty !== 'Insane') return [];
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, '1/8') * 1.2;
			let streamStart = -1,
				stream18Ids = [];
			for (let i = 0; i < notes.length - 4; i++) {
				const section = notes.slice(i, i + 5);
				const avgGap = section.slice(1).reduce((sum, n, idx) => sum + n.time - section[idx].time, 0) / 4;
				if (avgGap < threshold) {
					if (streamStart === -1) {
						streamStart = i;
						stream18Ids = [section[0].id];
					}
					stream18Ids.push(section[4].id);
				} else {
					if (stream18Ids.length >= 4 && difficulty === 'Hard') {
						violations.push({
							type: '1/8 Stream',
							severity: 'error',
							message: `${stream18Ids.length} consecutive 1/8 notes not allowed`,
							time: notes[streamStart].time,
							endTime: notes[streamStart + stream18Ids.length - 1].time,
							notes: stream18Ids,
							rule: `${difficulty}: Consecutive 1/8+ not allowed (except 3 grace notes)`
						});
					}
					streamStart = -1;
					stream18Ids = [];
				}
			}
			return violations;
		}
		static checkLNStreams(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			if (difficulty !== 'Insane' && difficulty !== 'Expert') return [];
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, '1/6') * 1.2;
			const lns = notes.filter(n => n.isLN);
			let streamStart = -1,
				streamCount = 0,
				lnStreamIds = [];
			for (let i = 1; i < lns.length; i++) {
				if (lns[i].time - lns[i - 1].time < threshold) {
					if (streamStart === -1) {
						streamStart = i - 1;
						lnStreamIds = [lns[i - 1].id];
					}
					streamCount++;
					lnStreamIds.push(lns[i].id);
				} else {
					if (streamCount >= 2 && difficulty === 'Insane') {
						violations.push({
							type: '1/6+ LN Stream',
							severity: 'warning',
							message: `${streamCount + 1} LNs at 1/6+ snap (very hard to release accurately)`,
							time: lns[streamStart].time,
							endTime: lns[i - 1].time,
							notes: lnStreamIds,
							rule: `${difficulty}: Avoid 1/6+ LN streams, use regular notes instead`
						});
					}
					streamStart = -1;
					streamCount = 0;
					lnStreamIds = [];
				}
			}
			return violations;
		}
		static checkGraceNotes(beatmapData, rules) {
			const {
				notes,
				bpm,
				difficulty
			} = beatmapData;
			if (difficulty !== 'Hard') return [];
			const violations = [];
			const threshold = this.getSnapThreshold(bpm, '1/8') * 1.15;
			let graceStart = -1,
				graceCount = 0,
				graceNoteIds = [];
			for (let i = 1; i < notes.length; i++) {
				if (notes[i].time - notes[i - 1].time < threshold) {
					if (graceStart === -1) {
						graceStart = i - 1;
						graceNoteIds = [notes[i - 1].id];
					}
					graceCount++;
					graceNoteIds.push(notes[i].id);
				} else {
					if (graceCount > 3) {
						violations.push({
							type: '1/8+ Stream',
							severity: 'warning',
							message: `${graceCount} consecutive 1/8+ notes (only 3 grace notes allowed)`,
							time: notes[graceStart].time,
							endTime: notes[i - 1].time,
							notes: graceNoteIds,
							rule: `${difficulty}: Max 3 grace notes at 1/8+, not full streams`
						});
					}
					graceStart = -1;
					graceCount = 0;
					graceNoteIds = [];
				}
			}
			return violations;
		}
		static checkHandsInStreams(beatmapData, rules) {
			const {
				notes,
				bpm,
				cs,
				difficulty
			} = beatmapData;
			if (cs !== 7 || difficulty !== 'Hard') return [];
			const violations = [];
			const chords = this.getChords(notes);
			const hands = chords.filter(c => c.cols.length >= 3);
			for (let i = 1; i < hands.length; i++) {
				const beats = (hands[i].time - hands[i - 1].time) / (60000 / bpm);
				if (beats < 4) {
					violations.push({
						type: 'Hand Spacing',
						severity: 'warning',
						message: `Hands only ${beats.toFixed(1)} beats apart (minimum 4 beats)`,
						time: hands[i - 1].time,
						endTime: hands[i].time,
						notes: [...hands[i - 1].notes, ...hands[i].notes],
						rule: `${difficulty} 7K: Hands must be at least 1 measure (4 beats) apart`
					});
				}
			}
			return violations;
		}
		static checkPatternLength(beatmapData, maxLength, patternType, displayName) {
			const {
				notes,
				difficulty
			} = beatmapData;
			const violations = [];
			let patternStart = -1,
				patternLength = 0,
				patternNoteIds = [];
			for (let i = 0; i < notes.length; i++) {
				const pattern = this.analyzePattern(notes, i, Math.min(20, notes.length - i));
				if (pattern.type === patternType) {
					if (patternStart === -1) {
						patternStart = i;
						patternNoteIds = [];
					}
					patternLength++;
					patternNoteIds.push(notes[i].id);
				} else {
					if (patternLength > maxLength) {
						violations.push({
							type: displayName,
							severity: 'warning',
							message: `${patternLength}-note ${patternType} exceeds ${maxLength}`,
							time: notes[patternStart].time,
							endTime: notes[i - 1].time,
							notes: patternNoteIds,
							rule: `${difficulty}: Max ${maxLength}-note ${patternType}s`
						});
					}
					patternStart = -1;
					patternLength = 0;
					patternNoteIds = [];
				}
			}
			return violations;
		}
	}
	// RC CHECKER MANAGER
	class RCCheckerManager {
		static async openRCChecker(autoOpen = false) {
			const beatmapId = this.getCurrentBeatmapId();
			if (!beatmapId) {
				if (!autoOpen) UI.showNotification('No beatmap detected on this page', 'error');
				return;
			}
			if (!autoOpen) UI.showNotification('Loading beatmap...', 'info', 2000);
			try {
				const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
				if (!response.ok) throw new Error('Failed to fetch beatmap');
				const osuFileContent = await response.text();
				const beatmapData = BeatmapParser.parseOsuContent(osuFileContent);
				const violations = RCChecker.checkMap(beatmapData);
				this.showRCCheckerPanel(beatmapData, violations);
			} catch (error) {
				debug.error('Failed to load beatmap:', error);
				if (!autoOpen) UI.showNotification('Failed to load beatmap', 'error');
			}
		}
		static getCurrentBeatmapId() {
			const hashMatch = window.location.hash.match(/#\w+\/(\d+)/);
			if (hashMatch) return hashMatch[1];
			const timelineMatch = window.location.pathname.match(/\/discussion\/(\d+)\/timeline/);
			if (timelineMatch) return timelineMatch[1];
			const discussionMatch = window.location.pathname.match(/\/discussion\/(\d+)/);
			return discussionMatch ? discussionMatch[1] : null;
		}
		static formatTime(ms) {
			const totalSeconds = Math.floor(ms / 1000);
			const minutes = Math.floor(totalSeconds / 60);
			const seconds = totalSeconds % 60;
			const milliseconds = Math.floor((ms % 1000));
			return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(milliseconds).padStart(3, '0')}`;
		}
		static exportModSummary(beatmapData, violations) {
			const errorCount = violations.filter(v => v.severity === 'error')
				.length;
			const warningCount = violations.filter(v => v.severity === 'warning')
				.length;
			let summary = `**${beatmapData.version}** - RC Check Summary\n\n`;
			summary += `**Errors:** ${errorCount} | **Warnings:** ${warningCount}\n\n`;
			if (violations.length === 0) {
				summary += `✓ No violations detected!\n`;
			} else {
				const grouped = {};
				violations.forEach(v => {
					if (!grouped[v.type]) grouped[v.type] = [];
					grouped[v.type].push(v);
				});
				Object.entries(grouped)
					.forEach(([type, viols]) => {
						summary += `**${type}** (${viols.length})\n`;
						viols.forEach(v => {
							const time = v.time !== null ? this.formatTime(v.time) : 'General';
							summary += `- ${time}: ${v.message}\n`;
						});
						summary += `\n`;
					});
			}
			navigator.clipboard.writeText(summary)
				.then(() => {
					UI.showNotification('Mod summary copied!', 'success');
				});
		}
		static showRCCheckerPanel(beatmapData, violations) {
			let panel = document.getElementById('rc-checker-panel');
			if (panel) panel.remove();
			const errorCount = violations.filter(v => v.severity === 'error')
				.length;
			const warningCount = violations.filter(v => v.severity === 'warning')
				.length;
			panel = Utils.createElement('div');
			panel.id = 'rc-checker-panel';
			panel.className = 'floating-panel';
			panel.style.width = '340px';
			panel.style.maxHeight = '700px';
			panel.dataset.currentViolations = JSON.stringify(violations);
			panel.dataset.currentBeatmapData = JSON.stringify({
				version: beatmapData.version,
				bpm: beatmapData.bpm,
				cs: beatmapData.cs,
				hp: beatmapData.hp,
				od: beatmapData.od,
				difficulty: beatmapData.difficulty
			});
			panel.innerHTML = `
    <button class="panel-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 10001;">×</button>
    <div class="panel-content" style="padding-top: 20px;">
        <div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
            <i class="fas fa-search"></i> RC Checker
        </div>
        <button id="export-mod-summary" class="feature-btn" style="width: 100%; margin-bottom: 8px; padding: 6px 10px; font-size: 11px;">
            <i class="fas fa-file-export"></i> Export Mod Summary
        </button>
        <div class="rc-summary">
            <div class="rc-info-grid" style="font-size: 11px; margin-bottom: 8px;">
                <div><strong>Version:</strong> ${beatmapData.version}</div>
                <div><strong>BPM:</strong> ${beatmapData.bpm}</div>
                <div><strong>Keys:</strong> ${beatmapData.cs}K</div>
                <div><strong>HP:</strong> ${beatmapData.hp}</div>
                <div><strong>OD:</strong> ${beatmapData.od}</div>
                <div><strong>Notes:</strong> ${beatmapData.notes.length}</div>
            </div>
            <div style="margin-bottom: 8px;">
                <label style="font-size: 11px; color: #eee; display: block; margin-bottom: 4px;">
                    <strong>Override Difficulty:</strong>
                </label>
                <select id="difficulty-override" style="width: 100%; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.08); color: #fff; padding: 5px 8px; border-radius: 4px; font-size: 11px;">
                    <option value="${beatmapData.difficulty}" selected>${beatmapData.difficulty} (Detected)</option>
                    <option value="Easy">Easy</option>
                    <option value="Normal">Normal</option>
                    <option value="Hard">Hard</option>
                    <option value="Insane">Insane</option>
                    <option value="Expert">Expert</option>
                </select>
            </div>
            <button id="recheck-difficulty" class="feature-btn" style="width: 100%; margin-bottom: 8px; padding: 6px 10px; font-size: 11px;">Re-check with Selected Difficulty</button>
            <div class="rc-violations-summary" style="padding-top: 8px; font-size: 12px;">
                <span class="error-count">${errorCount} errors</span>
                <span class="warning-count">${warningCount} warnings</span>
            </div>
        </div>
        <!-- Tabs -->
        <div style="display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); flex-wrap: wrap;">
            <button class="rc-tab active" data-tab="violations" style="flex: 1; min-width: 80px; background: rgba(255, 255, 255, 0.1); border: none; color: #fff; padding: 8px 12px; cursor: pointer; font-size: 11px; border-radius: 4px 4px 0 0; transition: all 0.15s ease;">Violations</button>
            <button class="rc-tab" data-tab="progression" style="flex: 1; min-width: 80px; background: rgba(26, 26, 26, 0.6); border: none; color: rgba(255, 255, 255, 0.7); padding: 8px 12px; cursor: pointer; font-size: 11px; border-radius: 4px 4px 0 0; transition: all 0.15s ease;">Progression</button>
        </div>
        <!-- Violations Tab -->
        <div class="rc-tab-content" data-content="violations" style="display: block;">
            <div id="violations-container">
                ${violations.length === 0 ? `
                    <div class="no-violations">
                        <i class="fas fa-check-circle"></i>
                        <p>No RC violations detected!</p>
                    </div>
                ` : `
                    <div class="violations-list">
                        ${violations.map((v, i) => this.createViolationCard(v, beatmapData)).join('')}
                    </div>
                `}
            </div>
        </div>
        <!-- Progression Tab -->
        <div class="rc-tab-content" data-content="progression" style="display: none;">
            <div id="progression-container">
                <div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.5);">
                    <i class="fas fa-chart-line" style="font-size: 48px; margin-bottom: 12px; opacity: 0.3;"></i>
                    <p>Click "Analyze Progression" to check difficulty spread</p>
                    <button id="analyze-progression" class="feature-btn" style="margin-top: 12px; padding: 8px 16px;">Analyze Progression</button>
                </div>
            </div>
        </div>
    </div>
`;
			document.body.appendChild(panel);
			panel.querySelector('#export-mod-summary')
				?.addEventListener('click', (e) => {
					e.stopPropagation();
					const currentViols = JSON.parse(panel.dataset.currentViolations || '[]');
					const currentData = JSON.parse(panel.dataset.currentBeatmapData || '{}');
					RCCheckerManager.exportModSummary(currentData, currentViols);
				});
			panel.style.cursor = 'move';
			UI.makeDraggable(panel, panel);
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
			const dropdown = panel.querySelector('#difficulty-override');
			const recheckBtn = panel.querySelector('#recheck-difficulty');
			[dropdown, recheckBtn].forEach(el => {
				if (el) {
					el.addEventListener('mousedown', (e) => e.stopPropagation());
					el.addEventListener('click', (e) => e.stopPropagation());
				}
			});
			closeBtn.addEventListener('mouseenter', () => {
				closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
				closeBtn.style.color = '#fff';
			});
			closeBtn.addEventListener('mouseleave', () => {
				closeBtn.style.background = 'none';
				closeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
			});
			closeBtn.addEventListener('click', () => panel.remove());
			panel.addEventListener('click', (e) => {
				const btn = e.target.closest('.copy-notes-btn');
				if (btn) {
					const notes = btn.dataset.notes;
					if (notes) {
						navigator.clipboard.writeText(notes)
							.then(() => {
								UI.showNotification('Note selection copied!', 'success');
							});
					}
				}
			});
			const recheckWithDifficulty = async () => {
				const selectedDifficulty = panel.querySelector('#difficulty-override')
					.value;
				const beatmapId = RCCheckerManager.getCurrentBeatmapId();
				if (!beatmapId) {
					UI.showNotification('Cannot detect current beatmap', 'error');
					return;
				}
				try {
					const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
					if (!response.ok) throw new Error('Failed to fetch');
					const osuContent = await response.text();
					const freshBeatmapData = BeatmapParser.parseOsuContent(osuContent);
					freshBeatmapData.difficulty = selectedDifficulty;
					const newViolations = RCChecker.checkMap(freshBeatmapData);
					panel.dataset.currentViolations = JSON.stringify(newViolations);
					panel.dataset.currentBeatmapData = JSON.stringify({
						version: freshBeatmapData.version,
						bpm: freshBeatmapData.bpm,
						cs: freshBeatmapData.cs,
						hp: freshBeatmapData.hp,
						od: freshBeatmapData.od,
						difficulty: freshBeatmapData.difficulty
					});
					const newErrorCount = newViolations.filter(v => v.severity === 'error')
						.length;
					const newWarningCount = newViolations.filter(v => v.severity === 'warning')
						.length;
					panel.querySelector('.error-count')
						.textContent = `${newErrorCount} errors`;
					panel.querySelector('.warning-count')
						.textContent = `${newWarningCount} warnings`;
					const container = panel.querySelector('#violations-container');
					container.innerHTML = newViolations.length === 0 ? `
                    <div class="no-violations">
                        <i class="fas fa-check-circle"></i>
                        <p>No RC violations detected!</p>
                    </div>
                ` : `
                    <div class="violations-list">
                        ${newViolations.map(v => RCCheckerManager.createViolationCard(v, freshBeatmapData)).join('')}
                    </div>
                `;
					const previewPanel = document.getElementById('beatmap-preview-player');
					if (previewPanel && window.beatmapPreviewInstance) {
						window.beatmapPreviewInstance.renderDensityScrollbar(newViolations);
					}
					UI.showNotification(`Re-checked as ${selectedDifficulty}`, 'success');
				} catch (error) {
					debug.error('Re-check failed:', error);
					UI.showNotification('Failed to re-check beatmap', 'error');
				}
			};
			panel.querySelector('#recheck-difficulty')
				.addEventListener('click', recheckWithDifficulty);
			panel.querySelector('#difficulty-override')
				.addEventListener('change', recheckWithDifficulty);
			const rcTabs = panel.querySelectorAll('.rc-tab');
			const rcTabContents = panel.querySelectorAll('.rc-tab-content');
			rcTabs.forEach(tab => {
				tab.addEventListener('click', () => {
					const targetTab = tab.dataset.tab;
					rcTabs.forEach(t => {
						t.style.background = 'rgba(26, 26, 26, 0.6)';
						t.style.color = 'rgba(255, 255, 255, 0.7)';
						t.classList.remove('active');
					});
					rcTabContents.forEach(c => {
						c.style.display = c.dataset.content === targetTab ? 'block' : 'none';
					});
					tab.style.background = 'rgba(255, 255, 255, 0.1)';
					tab.style.color = '#fff';
					tab.classList.add('active');
				});
				tab.addEventListener('mousedown', (e) => e.stopPropagation());
			});
			panel.querySelector('#analyze-progression')
				?.addEventListener('click', async () => {
					await RCCheckerManager.analyzeProgression(panel);
				});
		}
		static createViolationCard(v, beatmapData) {
			const editorLink = v.notes && v.notes.length > 0 ?
				this.formatEditorLink(v.notes, beatmapData) :
				'';
			return `
            <div class="violation-card ${v.severity}">
                <div class="violation-header">
                    <span class="violation-type">${v.type}</span>
                    <span class="violation-severity">${v.severity}</span>
                </div>
                <div class="violation-message">${v.message}</div>
                ${v.time !== null ? `
                    <div class="violation-time">
                        ${this.formatTime(v.time)}${v.endTime ? ` - ${this.formatTime(v.endTime)}` : ''}
                    </div>
                ` : ''}
                ${editorLink ? `
                    <div class="violation-notes">
                        <button class="copy-notes-btn" data-notes="${editorLink.replace(/"/g, '&quot;')}" title="Copy editor link">
                            <i class="fas fa-copy"></i> Copy Editor Link
                        </button>
                    </div>
                ` : ''}
                <div class="violation-rule">${v.rule}</div>
            </div>
        `;
		}
		static formatEditorLink(noteIds, beatmapData) {
			if (!noteIds || noteIds.length === 0 || !beatmapData || !beatmapData.notes) return '';
			const notes = noteIds.map(id => {
					return beatmapData.notes.find(n => n.id === id);
				})
				.filter(n => n !== undefined);
			if (notes.length === 0) return '';
			notes.sort((a, b) => a.time - b.time);
			const timestamp = this.formatTime(notes[0].time);
			const noteSelection = notes
				.map(n => `${Math.round(n.time)}|${n.col}`)
				.join(',');
			return `${timestamp} (${noteSelection}) -`;
		}
		static async analyzeProgression(panel) {
			const container = panel.querySelector('#progression-container');
			container.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 32px;"></i></div>';
			try {
				const difficulties = ComparisonMode.parseDifficultiesFromPage();
				if (difficulties.length < 2) {
					container.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255, 255, 255, 0.5);">Need at least 2 difficulties in the set</div>';
					return;
				}
				UI.showNotification('Loading all difficulties...', 'info');
				const diffData = await Promise.all(
					difficulties.map(async (d) => {
						try {
							const data = await ComparisonMode.fetchBeatmapData(d.id);
							return {
								id: d.id,
								name: d.name,
								...data
							};
						} catch (error) {
							debug.error('Failed to load', d.name, error);
							return null;
						}
					})
				);
				const validDiffs = diffData.filter(d => d !== null);
				if (validDiffs.length < 2) {
					container.innerHTML = '<div style="text-align: center; padding: 40px; color: #ff6b6b;">Failed to load difficulties</div>';
					return;
				}
				validDiffs.sort((a, b) => a.notes.length - b.notes.length);
				const analysis = this.analyzeSpread(validDiffs);
				container.innerHTML = this.renderProgressionAnalysis(validDiffs, analysis);
				container.querySelectorAll('.compare-diffs-btn')
					.forEach(btn => {
						btn.addEventListener('click', async () => {
							const id1 = btn.dataset.id1;
							const id2 = btn.dataset.id2;
							const d1 = validDiffs.find(d => d.id === id1);
							const d2 = validDiffs.find(d => d.id === id2);
							if (d1 && d2) {
								ComparisonMode.showComparisonView(d1, d2);
							}
						});
					});
			} catch (error) {
				debug.error('Progression analysis failed:', error);
				container.innerHTML = '<div style="text-align: center; padding: 40px; color: #ff6b6b;">Analysis failed</div>';
			}
		}
		static analyzeSpread(diffs) {
			const issues = [];
			const suggestions = [];
			for (let i = 1; i < diffs.length; i++) {
				const prev = diffs[i - 1];
				const curr = diffs[i];
				if (curr.hp < prev.hp) {
					issues.push({
						type: 'HP Regression',
						message: `${curr.name} (HP ${curr.hp}) has lower HP than ${prev.name} (HP ${prev.hp})`,
						severity: 'warning'
					});
				}
				if (curr.od < prev.od) {
					issues.push({
						type: 'OD Regression',
						message: `${curr.name} (OD ${curr.od}) has lower OD than ${prev.name} (OD ${prev.od})`,
						severity: 'warning'
					});
				}
				const noteRatio = curr.notes.length / prev.notes.length;
				if (noteRatio > 1.8) {
					issues.push({
						type: 'Large Note Jump',
						message: `${Math.round((noteRatio - 1) * 100)}% note increase from ${prev.name} to ${curr.name}`,
						severity: 'warning'
					});
				}
			}
			const diffTypes = ['Easy', 'Normal', 'Hard', 'Insane', 'Expert'];
			const hasDiffTypes = diffs.map(d => {
					for (const type of diffTypes) {
						if (d.name.toLowerCase()
							.includes(type.toLowerCase())) {
							return type;
						}
					}
					return null;
				})
				.filter(Boolean);
			if (diffs.length >= 2) {
				const lowest = diffs[0];
				const highest = diffs[diffs.length - 1];
				if (lowest.notes.length > 300 && !hasDiffTypes.includes('Easy')) {
					suggestions.push('Consider adding an Easy difficulty');
				}
				if (diffs.length === 2 && highest.notes.length > 800) {
					suggestions.push('Consider adding a middle difficulty (Normal/Hard)');
				}
			}
			return {
				issues,
				suggestions
			};
		}
		static renderProgressionAnalysis(diffs, analysis) {
			const {
				issues,
				suggestions
			} = analysis;
			return `
        <div style="padding: 12px;">
            <div style="background: rgba(26, 26, 26, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 12px; margin-bottom: 14px;">
                <div style="font-size: 11px; color: #eee; margin-bottom: 8px;">
                    <strong>Difficulties:</strong> ${diffs.length}<br>
                    <strong>Note Range:</strong> ${diffs[0].notes.length} → ${diffs[diffs.length - 1].notes.length}<br>
                    <strong>HP Range:</strong> ${Math.min(...diffs.map(d => d.hp))} → ${Math.max(...diffs.map(d => d.hp))}<br>
                    <strong>OD Range:</strong> ${Math.min(...diffs.map(d => d.od))} → ${Math.max(...diffs.map(d => d.od))}
                </div>
                <div style="display: flex; gap: 12px; font-size: 12px; font-weight: 600; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
                    <span style="color: #ff6b6b;">${issues.length} issues</span>
                    <span style="color: #6bb6ff;">${suggestions.length} suggestions</span>
                </div>
            </div>
            <div style="margin-bottom: 14px;">
                <div style="font-size: 11px; color: rgba(255, 255, 255, 0.7); margin-bottom: 6px; font-weight: 600;">
                    Difficulty Progression:
                </div>
                ${diffs.map((d, i) => `
                    <div style="background: rgba(26, 26, 26, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 8px; margin-bottom: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 11px; color: #eee; font-weight: 600;">${i + 1}. ${Utils.sanitizeHTML(d.name)}</span>
                            ${i > 0 ? `
                                <button class="compare-diffs-btn" data-id1="${diffs[i-1].id}" data-id2="${d.id}" style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 9px;">
                                    <i class="fas fa-columns"></i> Compare
                                </button>
                            ` : ''}
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-size: 10px; color: rgba(255, 255, 255, 0.6);">
                            <div><strong>Notes:</strong> ${d.notes.length}</div>
                            <div><strong>LNs:</strong> ${d.notes.filter(n => n.isLN).length}</div>
                            <div><strong>HP:</strong> ${d.hp}</div>
                            <div><strong>OD:</strong> ${d.od}</div>
                        </div>
                        ${i > 0 ? `
                            <div style="margin-top: 4px; font-size: 9px; color: rgba(255, 255, 255, 0.4);">
                                +${Math.round((d.notes.length / diffs[i-1].notes.length - 1) * 100)}% notes vs previous
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
            ${issues.length > 0 ? `
                <div style="margin-bottom: 14px;">
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.7); margin-bottom: 6px; font-weight: 600;">
                        Issues Found:
                    </div>
                    ${issues.map(issue => `
                        <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 4px; padding: 8px; margin-bottom: 6px;">
                            <div style="font-size: 11px; color: #ff6b6b; font-weight: 600; margin-bottom: 2px;">${issue.type}</div>
                            <div style="font-size: 10px; color: rgba(255, 255, 255, 0.8);">${issue.message}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            ${suggestions.length > 0 ? `
                <div>
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.7); margin-bottom: 6px; font-weight: 600;">
                        Suggestions:
                    </div>
                    ${suggestions.map(suggestion => `
                        <div style="background: rgba(107, 182, 255, 0.1); border: 1px solid rgba(107, 182, 255, 0.3); border-radius: 4px; padding: 8px; margin-bottom: 6px;">
                            <div style="font-size: 10px; color: rgba(107, 182, 255, 1);">
                                <i class="fas fa-lightbulb"></i> ${suggestion}
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            ${issues.length === 0 && suggestions.length === 0 ? `
                <div style="text-align: center; padding: 30px; color: #4caf50;">
                    <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
                    <p>Difficulty progression looks good!</p>
                </div>
            ` : ''}
        </div>
    `;
		}
	}
	// WORDING HELPER CONFIG
	const WORDING_CONFIG = {
		STORAGE_KEY: 'osuWordingHelperSettings',
		CACHE_DURATION: 3600000,
		MAX_SUGGESTIONS: 15,
		DEBOUNCE_DELAY: 300,
		APIS: {
			DATAMUSE: 'https://api.datamuse.com/words',
			DICTIONARY: 'https://api.dictionaryapi.dev/api/v2/entries/en',
			LANGUAGETOOL: 'https://api.languagetool.org/v2/check',
		}
	};
	const PASSIVE_VOICE_PATTERNS = [
		/\b(is|are|was|were|be|been|being)\s+(being\s+)?\w+(ed|en)\b/gi,
		/\b(is|are|was|were|be|been|being)\s+\w+\s+(to|by)\b/gi
	];
	const FILLER_WORDS = new Set([
		'just', 'actually', 'basically', 'literally', 'seriously',
		'honestly', 'obviously', 'clearly', 'simply', 'merely'
	]);
	const WEAK_WORDS = new Set([
		'very', 'really', 'quite', 'somewhat', 'kind of', 'sort of',
		'a bit', 'a little', 'pretty', 'rather', 'fairly', 'slightly',
		'basically', 'mostly', 'virtually', 'relatively', 'mildly',
		'essentially', 'almost', 'nearly', 'kinda', 'sorta',
		'approximately', 'roughly', 'in a way', 'in some sense',
		'to some extent', 'to a degree', 'in part', 'partially',
		'a touch', 'barely', 'hardly', 'marginally', 'loosely',
		'supposedly', 'arguably', 'seemingly', 'ostensibly',
		'somehow', 'maybe', 'perhaps', 'possibly', 'probably',
		'apparently', 'presumably', 'often', 'sometimes',
		'occasionally', 'from time to time', 'tend to', 'can be',
		'kindasorta', 'more or less', 'sort of like', 'a tad', 'bit of'
	]);
	const VULGAR_TERMS = new Set([
		'fuck', 'shit', 'damn', 'hell', 'ass', 'bitch', 'bastard',
		'crap', 'piss', 'cock', 'dick', 'pussy', 'cunt', 'whore',
		'slut', 'douche', 'douchebag', 'bollocks', 'bugger', 'bloody',
		'jackass', 'motherfucker', 'bullshit', 'horseshit', 'dipshit',
		'asshole', 'arsehole', 'prick', 'twat', 'wanker', 'jerk',
		'dumbass', 'smartass', 'hardass', 'badass', 'jackoff', 'jack off',
		'screw', 'screwed', 'screwing', 'banging', 'boner', 'nuts', 'balls',
		'butt', 'boobs', 'tits', 'nipples', 'cum', 'jizz', 'spunk', 'spooge',
		'fart', 'craphead', 'shithead', 'fuckhead', 'dipshit', 'dickhead',
		'arse', 'turd', 'scumbag', 'jerkwad', 'shitface', 'fuckface',
		'goddamn', 'hellhole', 'clusterfuck', 'shitshow', 'dickwad',
		'shitbag', 'bastards', 'fucking', 'fucked', 'fucker'
	]);
	const OSU_MANIA_VOCAB = {
		'pattern': ['arrangement', 'sequence', 'structure', 'formation', 'layout', 'design', 'setup', 'configuration', 'composition', 'ordering'],
		'note': ['object', 'tap', 'key', 'hit', 'input', 'press', 'hit object', 'element', 'marker'],
		'chord': ['stack', 'simultaneous notes', 'multiple notes', 'hand', 'multi-press', 'double note', 'cluster', 'bracket pair'],
		'stream': ['burst', 'dense section', 'consecutive notes', 'rapid sequence', 'continuous notes', 'flow section', 'run', 'string'],
		'trill': ['alternating pattern', 'two-key alternation', 'back-and-forth', 'repeating switch', 'double stream', 'oscillation'],
		'jack': ['repeated column', 'same-key spam', 'anchor spam', 'minijack', 'repetition', 'key repetition', 'column spam'],
		'jumptrill': ['double trill', 'chord trill', 'split trill', 'two-hand trill', 'bracket trill'],
		'anchor': ['repeated column', 'jack section', 'same-key pattern', 'fixed column', 'column repetition', 'sustained column'],
		'roll': ['sequential pattern', 'staircase', 'cascade', 'ladder', 'ascending pattern', 'descending pattern', 'scale', 'run'],
		'handstream': ['chord stream', 'dense chords', 'heavy stream', 'multi-note stream', 'bracket stream'],
		'jumpstream': ['chord stream', 'jump-heavy section', 'bracket stream', 'jump-focused stream', 'chord-based stream'],
		'ln': ['long note', 'hold note', 'sustained note', 'release', 'hold', 'sustain', 'noodle', 'slider'],
		'shield': ['hold + tap', 'ln with notes', 'hold pattern', 'ln overlay', 'protected hold', 'covered sustain'],
		'inverse': ['opposite ln pattern', 'reversed shield', 'alternating holds', 'inverse mapping', 'complementary holds'],
		'release': ['ln ending', 'hold release', 'tail', 'note end', 'release timing', 'terminus', 'conclusion'],
		'snap': ['rhythm', 'timing', 'division', 'beat', 'grid alignment', 'timing step', 'quantization', 'subdivision'],
		'snapping': ['timing division', 'rhythm placement', 'beat alignment', 'timing grid', 'quantization', 'rhythmic spacing'],
		'timing': ['sync', 'alignment', 'rhythm accuracy', 'beat placement', 'synchronization', 'tempo adherence'],
		'overmapped': ['excessive', 'overcharted', 'too dense', 'forced', 'unnecessary', 'inflated', 'overrepresented', 'exaggerated'],
		'undermapped': ['lacking', 'undercharted', 'sparse', 'empty', 'minimal', 'incomplete', 'insufficient', 'neglected'],
		'ghost': ['unsnapped', 'mistimed', 'off-grid', 'misaligned', 'desynced', 'invalid note', 'misplaced', 'erroneous'],
		'dense': ['heavy', 'packed', 'intense', 'crowded', 'busy', 'compressed', 'loaded', 'concentrated', 'thick'],
		'sparse': ['light', 'thin', 'minimal', 'empty', 'spacious', 'open', 'scattered', 'spread out', 'diluted'],
		'hard': ['difficult', 'challenging', 'demanding', 'tough', 'intense', 'brutal', 'punishing', 'severe'],
		'easy': ['simple', 'accessible', 'straightforward', 'basic', 'introductory', 'gentle', 'lenient', 'forgiving'],
		'spike': ['difficulty jump', 'sudden increase', 'peak', 'burst', 'intensity jump', 'surge', 'escalation'],
		'stamina': ['endurance', 'sustainability', 'long-term difficulty', 'continuous strain', 'persistence', 'durability'],
		'tech': ['technical', 'complex', 'pattern-heavy', 'skill-demanding', 'intricate', 'sophisticated', 'advanced'],
		'awkward': ['uncomfortable', 'clunky', 'unnatural', 'forced', 'jarring', 'strained', 'disjointed', 'ungainly'],
		'smooth': ['comfortable', 'natural', 'flowing', 'clean', 'seamless', 'fluid', 'graceful', 'effortless'],
		'comfortable': ['smooth', 'natural', 'playable', 'ergonomic', 'relaxed', 'intuitive', 'accessible', 'user-friendly'],
		'flow': ['transition', 'movement', 'progression', 'continuity', 'pacing', 'momentum', 'rhythm', 'cadence'],
		'jarring': ['abrupt', 'sudden', 'harsh', 'rough', 'disruptive', 'shocking', 'jolting', 'discordant'],
		'emphasis': ['accent', 'highlight', 'stress', 'focus', 'impact', 'attention', 'prominence', 'weight'],
		'layering': ['structure', 'sound representation', 'instrument mapping', 'note layering', 'stratification', 'composition'],
		'representation': ['interpretation', 'expression', 'capture', 'portrayal', 'depiction', 'embodiment', 'manifestation'],
		'consistency': ['uniformity', 'coherence', 'pattern adherence', 'standardization', 'predictability', 'regularity', 'stability'],
		'contrast': ['variation', 'difference', 'distinction', 'diversity', 'dynamism', 'juxtaposition', 'divergence'],
		'variety': ['diversity', 'variation', 'contrast', 'mix', 'range', 'versatility', 'assortment', 'multiplicity'],
		'issue': ['problem', 'concern', 'flaw', 'mistake', 'error', 'inconsistency', 'defect', 'fault'],
		'suggestion': ['recommendation', 'proposal', 'idea', 'alternative', 'tip', 'advice', 'proposition'],
		'improvement': ['enhancement', 'refinement', 'upgrade', 'polish', 'adjustment', 'optimization', 'amelioration'],
		'change': ['adjustment', 'modification', 'alteration', 'revision', 'update', 'amendment', 'transformation'],
		'consider': ['try', 'attempt', 'explore', 'evaluate', 'reflect', 'contemplate', 'examine', 'assess'],
		'suggest': ['recommend', 'propose', 'advise', 'advocate', 'offer', 'put forward', 'submit'],
		'improve': ['enhance', 'refine', 'strengthen', 'optimize', 'upgrade', 'polish', 'perfect', 'elevate'],
		'adjust': ['modify', 'change', 'tweak', 'refine', 'shift', 'alter', 'adapt', 'fine-tune']
	};
	// WORDING HELPER SERVICES
	class WordingCacheManager {
		constructor() {
			this.cache = new Map();
			this.stats = {
				hits: 0,
				misses: 0
			};
		}
		set(key, value) {
			this.cache.set(key, {
				value,
				timestamp: Date.now()
			});
		}
		get(key) {
			const item = this.cache.get(key);
			if (!item || Date.now() - item.timestamp > WORDING_CONFIG.CACHE_DURATION) {
				if (item) this.cache.delete(key);
				this.stats.misses++;
				return null;
			}
			this.stats.hits++;
			return item.value;
		}
		clear() {
			this.cache.clear();
			this.stats = {
				hits: 0,
				misses: 0
			};
		}
	}
	class TextAnalyzer {
		static calculateReadability(text) {
			const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
			const words = text.split(/\s+/).filter(w => w.trim().length > 0);
			const syllables = words.reduce((count, word) => count + this.countSyllables(word), 0);
			if (sentences.length === 0 || words.length === 0) return {
				score: 0,
				grade: 'N/A',
				level: 'N/A'
			};
			const avgWords = words.length / sentences.length;
			const avgSyllables = syllables / words.length;
			const fleschScore = Math.max(0, Math.min(100, 206.835 - 1.015 * avgWords - 84.6 * avgSyllables));
			const gradeLevel = 0.39 * avgWords + 11.8 * avgSyllables - 15.59;
			let level = 'Very Easy';
			if (fleschScore < 30) level = 'Very Difficult';
			else if (fleschScore < 50) level = 'Difficult';
			else if (fleschScore < 60) level = 'Fairly Difficult';
			else if (fleschScore < 70) level = 'Standard';
			else if (fleschScore < 80) level = 'Fairly Easy';
			else if (fleschScore < 90) level = 'Easy';
			return {
				score: Math.round(fleschScore),
				grade: Math.max(0, Math.round(gradeLevel)),
				level
			};
		}
		static countSyllables(word) {
			word = word.toLowerCase().replace(/[^a-z]/g, '');
			if (word.length <= 3) return 1;
			word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
			const syllables = word.match(/[aeiouy]{1,2}/g);
			return syllables ? syllables.length : 1;
		}
		static analyzeSentiment(text) {
			const positive = ['good', 'great', 'excellent', 'nice', 'well', 'better', 'best', 'effective', 'clean', 'smooth', 'comfortable', 'clear', 'strong', 'solid', 'impressive'];
			const negative = ['bad', 'poor', 'terrible', 'awful', 'worse', 'worst', 'weak', 'awkward', 'uncomfortable', 'confusing', 'messy', 'clunky', 'forced', 'wrong', 'broken'];
			const harsh = ['stupid', 'dumb', 'terrible', 'awful', 'horrible', 'trash', 'garbage', 'sucks', 'hate', 'terrible'];
			const words = text.toLowerCase().split(/\s+/);
			let score = 0,
				harshCount = 0;
			words.forEach(word => {
				if (positive.includes(word)) score += 1;
				if (negative.includes(word)) score -= 1;
				if (harsh.includes(word)) {
					score -= 2;
					harshCount++;
				}
			});
			const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
			const normalizedScore = sentenceCount > 0 ? score / sentenceCount : score;
			let sentiment = 'neutral';
			if (normalizedScore > 0.3) sentiment = 'positive';
			else if (normalizedScore < -0.3) sentiment = 'negative';
			else if (normalizedScore < -0.7 || harshCount > 0) sentiment = 'very negative';
			return {
				sentiment,
				score: normalizedScore,
				harshCount
			};
		}
		static detectPassiveVoice(text) {
			const matches = [];
			PASSIVE_VOICE_PATTERNS.forEach(pattern => {
				const found = text.match(pattern);
				if (found) matches.push(...found);
			});
			return [...new Set(matches)];
		}
		static detectRepetition(text) {
			const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
			const counts = {};
			words.forEach(word => counts[word] = (counts[word] || 0) + 1);
			return Object.entries(counts)
				.filter(([word, count]) => count > 2 && !['this', 'that', 'these', 'those', 'with', 'from', 'have', 'been'].includes(word))
				.sort((a, b) => b[1] - a[1])
				.slice(0, 5);
		}
		static MOD_TAG_COLORS = {
			negative: {
				color: '#fffafa',
				bg: 'rgba(255,240,240,0.08)',
				border: 'rgba(255,220,220,0.15)',
				category: 'negative'
			},
			awkward: 'negative',
			uncomfortable: 'negative',
			clunky: 'negative',
			forced: 'negative',
			jarring: 'negative',
			wrong: 'negative',
			inconsistent: 'negative',
			bad: 'negative',
			broken: 'negative',
			messy: 'negative',
			odd: 'negative',
			weird: 'negative',
			strange: 'negative',
			confusing: 'negative',
			unclear: 'negative',
			problematic: 'negative',
			unnatural: 'negative',
			unfitting: 'negative',
			unsuitable: 'negative',
			inappropriate: 'negative',
			rough: 'negative',
			harsh: 'negative',
			abrupt: 'negative',
			sudden: 'negative',
			disjointed: 'negative',
			disconnected: 'negative',
			misaligned: 'negative',
			mismatched: 'negative',
			incorrect: 'negative',
			flawed: 'negative',
			imperfect: 'negative',
			empty: 'negative',
			void: 'negative',
			issue: 'negative',
			problem: 'negative',
			unplayable: 'negative',
			unreadable: 'negative',
			unintuitive: 'negative',
			unpolished: 'negative',
			incomplete: 'negative',
			critical: 'negative',
			unrankable: 'negative',
			disqualified: 'negative',
			alert: {
				color: '#fffbf9',
				bg: 'rgba(255,248,245,0.08)',
				border: 'rgba(255,235,220,0.15)',
				category: 'alert'
			},
			overmapped: 'alert',
			dense: 'alert',
			overcharted: 'alert',
			overloaded: 'alert',
			intense: 'alert',
			excessive: 'alert',
			heavy: 'alert',
			crowded: 'alert',
			packed: 'alert',
			overwhelming: 'alert',
			busy: 'alert',
			cramped: 'alert',
			cluttered: 'alert',
			congested: 'alert',
			compressed: 'alert',
			tight: 'alert',
			inflated: 'alert',
			exaggerated: 'alert',
			overdone: 'alert',
			insane: 'alert',
			expert: 'alert',
			concern: 'alert',
			severe: 'alert',
			extreme: 'alert',
			major: 'alert',
			required: 'alert',
			mandatory: 'alert',
			technical: {
				color: '#fdfaff',
				bg: 'rgba(250,248,255,0.08)',
				border: 'rgba(240,235,255,0.15)',
				category: 'technical'
			},
			release: 'technical',
			ln: 'technical',
			hold: 'technical',
			control: 'technical',
			timing: 'technical',
			precision: 'technical',
			accuracy: 'technical',
			snap: 'technical',
			snapping: 'technical',
			snapped: 'technical',
			unsnapped: 'technical',
			missnapped: 'technical',
			offbeat: 'technical',
			synced: 'technical',
			desynced: 'technical',
			offset: 'technical',
			delayed: 'technical',
			early: 'technical',
			late: 'technical',
			hitsound: 'technical',
			hitsounding: 'technical',
			whistle: 'technical',
			clap: 'technical',
			finish: 'technical',
			sample: 'technical',
			sampleset: 'technical',
			feedback: 'technical',
			audio: 'technical',
			sound: 'technical',
			metadata: 'technical',
			artist: 'technical',
			title: 'technical',
			source: 'technical',
			tags: 'technical',
			background: 'technical',
			preview: 'technical',
			bpm: 'technical',
			visual: 'technical',
			storyboard: 'technical',
			skin: 'technical',
			combo: 'technical',
			color: 'technical',
			visibility: 'technical',
			timestamp: 'technical',
			format: 'technical',
			file: 'technical',
			folder: 'technical',
			link: 'technical',
			download: 'technical',
			upload: 'technical',
			pattern: {
				color: '#fafaff',
				bg: 'rgba(248,248,255,0.08)',
				border: 'rgba(235,240,255,0.15)',
				category: 'pattern'
			},
			jack: 'pattern',
			trill: 'pattern',
			anchor: 'pattern',
			stream: 'pattern',
			chord: 'pattern',
			speed: 'pattern',
			burst: 'pattern',
			jumpstream: 'pattern',
			jumptrill: 'pattern',
			handstream: 'pattern',
			minijack: 'pattern',
			longjack: 'pattern',
			roll: 'pattern',
			staircase: 'pattern',
			ladder: 'pattern',
			cascade: 'pattern',
			splitjumptrill: 'pattern',
			bracket: 'pattern',
			hand: 'pattern',
			quad: 'pattern',
			glut: 'pattern',
			shield: 'pattern',
			inverse: 'pattern',
			grace: 'pattern',
			stamina: 'pattern',
			endurance: 'pattern',
			dump: 'pattern',
			difficulty: 'pattern',
			hard: 'pattern',
			spike: 'pattern',
			flow: {
				color: '#fffdf9',
				bg: 'rgba(255,252,248,0.08)',
				border: 'rgba(250,245,235,0.15)',
				category: 'flow'
			},
			bias: 'flow',
			imbalance: 'flow',
			unbalanced: 'flow',
			flow: 'flow',
			uneven: 'flow',
			transition: 'flow',
			pacing: 'flow',
			momentum: 'flow',
			rhythm: 'flow',
			rhythmic: 'flow',
			progression: 'flow',
			continuity: 'flow',
			cohesion: 'flow',
			cohesive: 'flow',
			fluidity: 'flow',
			fluid: 'flow',
			movement: 'flow',
			motion: 'flow',
			dynamic: 'flow',
			static: 'flow',
			spacing: 'flow',
			gap: 'flow',
			distance: 'flow',
			break: 'flow',
			pause: 'flow',
			rest: 'flow',
			spread: 'flow',
			curve: 'flow',
			contrast: 'flow',
			complex: {
				color: '#faffff',
				bg: 'rgba(248,255,255,0.08)',
				border: 'rgba(235,250,250,0.15)',
				category: 'complex'
			},
			tech: 'complex',
			technical: 'complex',
			complex: 'complex',
			tricky: 'complex',
			pattern: 'complex',
			difficult: 'complex',
			challenging: 'complex',
			demanding: 'complex',
			intricate: 'complex',
			sophisticated: 'complex',
			advanced: 'complex',
			nuanced: 'complex',
			subtle: 'complex',
			layered: 'complex',
			multifaceted: 'complex',
			creative: 'complex',
			constructive: {
				color: '#fffffa',
				bg: 'rgba(255,255,250,0.08)',
				border: 'rgba(252,252,235,0.15)',
				category: 'constructive'
			},
			suggestion: 'constructive',
			consider: 'constructive',
			try: 'constructive',
			idea: 'constructive',
			maybe: 'constructive',
			recommend: 'constructive',
			propose: 'constructive',
			alternative: 'constructive',
			option: 'constructive',
			possibility: 'constructive',
			potential: 'constructive',
			improvement: 'constructive',
			enhancement: 'constructive',
			refinement: 'constructive',
			adjustment: 'constructive',
			tweak: 'constructive',
			modification: 'constructive',
			change: 'constructive',
			remap: 'constructive',
			move: 'constructive',
			shift: 'constructive',
			replace: 'constructive',
			remove: 'constructive',
			add: 'constructive',
			delete: 'constructive',
			adjust: 'constructive',
			fix: 'constructive',
			correct: 'constructive',
			update: 'constructive',
			simplify: 'constructive',
			reduce: 'constructive',
			increase: 'constructive',
			emphasize: 'constructive',
			highlight: 'constructive',
			clarify: 'constructive',
			mod: 'constructive',
			modding: 'constructive',
			check: 'constructive',
			review: 'constructive',
			optional: 'constructive',
			recommended: 'constructive',
			suggested: 'constructive',
			positive: {
				color: '#fafffa',
				bg: 'rgba(248,255,248,0.08)',
				border: 'rgba(235,250,235,0.15)',
				category: 'positive'
			},
			clean: 'positive',
			good: 'positive',
			smooth: 'positive',
			nice: 'positive',
			accurate: 'positive',
			well: 'positive',
			perfect: 'positive',
			excellent: 'positive',
			great: 'positive',
			solid: 'positive',
			strong: 'positive',
			effective: 'positive',
			polished: 'positive',
			refined: 'positive',
			impressive: 'positive',
			enjoyable: 'positive',
			fun: 'positive',
			comfortable: 'positive',
			natural: 'positive',
			fitting: 'positive',
			appropriate: 'positive',
			balanced: 'positive',
			harmonious: 'positive',
			coherent: 'positive',
			clear: 'positive',
			readable: 'positive',
			playable: 'positive',
			fair: 'positive',
			reasonable: 'positive',
			manageable: 'positive',
			accessible: 'positive',
			intuitive: 'positive',
			logical: 'positive',
			sensible: 'positive',
			easy: 'positive',
			aesthetic: 'positive',
			rankable: 'positive',
			qualified: 'positive',
			quality: 'positive',
			finished: 'positive',
			complete: 'positive',
			unique: 'positive',
			final: 'positive',
			disqualified: 'positive',
			logic: {
				color: '#fbfffb',
				bg: 'rgba(250,255,250,0.08)',
				border: 'rgba(240,252,240,0.15)',
				category: 'logic'
			},
			intent: 'logic',
			emphasis: 'logic',
			structure: 'logic',
			consistent: 'logic',
			mapping: 'logic',
			layering: 'logic',
			representation: 'logic',
			interpretation: 'logic',
			expression: 'logic',
			concept: 'logic',
			theme: 'logic',
			motif: 'logic',
			consistency: 'logic',
			logic: 'logic',
			reasoning: 'logic',
			rationale: 'logic',
			justification: 'logic',
			purpose: 'logic',
			objective: 'logic',
			goal: 'logic',
			direction: 'logic',
			approach: 'logic',
			method: 'logic',
			technique: 'logic',
			strategy: 'logic',
			philosophy: 'logic',
			vocal: 'logic',
			instrumental: 'logic',
			melody: 'logic',
			percussion: 'logic',
			drum: 'logic',
			bass: 'logic',
			synth: 'logic',
			guitar: 'logic',
			piano: 'logic',
			kick: 'logic',
			snare: 'logic',
			hihat: 'logic',
			cymbal: 'logic',
			guidelines: 'logic',
			criteria: 'logic',
			rules: 'logic',
			rc: 'logic',
			intro: 'logic',
			verse: 'logic',
			chorus: 'logic',
			bridge: 'logic',
			outro: 'logic',
			buildup: 'logic',
			drop: 'logic',
			kiai: 'logic',
			section: 'logic',
			context: 'logic',
			style: 'logic',
			neutral: {
				color: '#fefefe',
				bg: 'rgba(250,250,250,0.05)',
				border: 'rgba(240,240,240,0.12)',
				category: 'neutral'
			},
			copy: 'neutral',
			repeat: 'neutral',
			same: 'neutral',
			redundant: 'neutral',
			repetitive: 'neutral',
			similar: 'neutral',
			identical: 'neutral',
			duplicate: 'neutral',
			mirrored: 'neutral',
			symmetrical: 'neutral',
			parallel: 'neutral',
			uniform: 'neutral',
			consistent: 'neutral',
			standard: 'neutral',
			conventional: 'neutral',
			typical: 'neutral',
			normal: 'neutral',
			regular: 'neutral',
			ordinary: 'neutral',
			common: 'neutral',
			basic: 'neutral',
			simple: 'neutral',
			straightforward: 'neutral',
			plain: 'neutral',
			sparse: 'neutral',
			mild: 'neutral',
			moderate: 'neutral',
			minor: 'neutral',
			note: 'neutral',
			observation: 'neutral',
			subjective: 'neutral',
			preference: 'neutral',
			opinion: 'neutral',
			personal: 'neutral',
			generic: 'neutral',
			previous: 'neutral',
			current: 'neutral',
			compared: 'neutral',
			reference: 'neutral',
			relative: 'neutral',
			conditional: 'neutral',
			situational: 'neutral',
			placeholder: 'neutral',
			temporary: 'neutral',
			version: 'neutral',
			draft: 'neutral',
			wip: 'neutral',
			getColors(tag) {
				const value = this[tag];
				if (typeof value === 'string') {
					return this[value];
				}
				return value;
			}
		};
		static categoryCache = new Map();
		static expandedVocabulary = new Map();
		static detectModTags(text) {
			const words = text.toLowerCase().split(/\s+/);
			const detected = new Map();
			for (const word of words) {
				const clean = word.replace(/[^a-z]/g, '');
				if (this.MOD_TAG_COLORS[clean] && !detected.has(clean)) {
					detected.set(clean, this.MOD_TAG_COLORS[clean]);
				}
			}
			return Array.from(detected, ([word, style]) => ({
				word,
				...style
			}));
		}
		static getCategoryGradient(tags) {
			const categories = [...new Set(tags.map(t => t.category))];
			if (categories.length === 1) {
				const tag = tags[0];
				return {
					border: `4px solid ${tag.color}`,
					background: `linear-gradient(135deg, rgba(255,255,255,0.02), ${tag.bg})`
				};
			}
			const colors = tags.map(t => t.color);
			const bgColors = tags.map(t => t.bg.replace('0.10', '0.18'));
			return {
				border: '4px solid transparent',
				borderImage: `linear-gradient(135deg, ${colors.join(', ')})`,
				borderImageSlice: 1,
				background: `linear-gradient(135deg, rgba(255,255,255,0.02), ${bgColors.join(', ')})`
			};
		}
		static colorizeModComments() {
			const discussions = document.querySelectorAll('.beatmap-discussion-post__message');
			discussions.forEach(discussion => {
				const text = discussion.textContent;
				const tags = this.detectModTags(text);
				if (!tags.length) return;
				const topDiv = discussion.closest('.beatmap-discussion__top');
				if (!topDiv || topDiv.dataset.modTagged) return;
				topDiv.dataset.modTagged = 'true';
				const gradient = this.getCategoryGradient(tags);
				Object.assign(topDiv.style, gradient);
				topDiv.style.border = 'none';
				topDiv.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
				topDiv.style.position = 'relative';
				topDiv.style.overflow = 'hidden';
				if (tags.length > 1) {
					const shimmer = document.createElement('div');
					shimmer.style.cssText = `
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg,
                    transparent,
                    rgba(255,255,255,0.08),
                    transparent
                );
                animation: shimmer 3s infinite;
                pointer-events: none;
            `;
					topDiv.appendChild(shimmer);
				}
				if (!discussion.querySelector('.mod-tag-indicator')) {
					const indicator = document.createElement('div');
					indicator.className = 'mod-tag-indicator';
					indicator.style.cssText = `
                margin-top: 10px;
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                border-top: 1px solid rgba(255,255,255,0.06);
                padding-top: 8px;
                opacity: 0;
                transform: translateY(6px);
                animation: fadeInTagEnhanced 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
            `;
					tags.slice(0, 6).forEach((tag, index) => {
						const badge = document.createElement('span');
						badge.textContent = `#${tag.word}`;
						badge.style.cssText = `
                    background: ${tag.bg};
                    border: 1.5px solid ${tag.border};
                    color: ${tag.color};
                    padding: 3px 10px;
                    border-radius: 14px;
                    font-size: 9px;
                    font-weight: 600;
                    text-transform: lowercase;
                    letter-spacing: 0.5px;
                    backdrop-filter: blur(8px);
                    box-shadow: 0 2px 8px ${tag.bg};
                    opacity: 0;
                    transform: scale(0.9) translateY(4px);
                    animation: popIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 0.08}s forwards;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    cursor: default;
                `;
						badge.addEventListener('mouseenter', () => {
							badge.style.transform = 'scale(1.01) translateY(-2px)';
							badge.style.boxShadow = `0 4px 12px ${tag.bg.replace('0.10', '0.35')}`;
							badge.style.borderColor = tag.color;
						});
						badge.addEventListener('mouseleave', () => {
							badge.style.transform = 'scale(1) translateY(0)';
							badge.style.boxShadow = `0 2px 8px ${tag.bg}`;
							badge.style.borderColor = tag.border;
						});
						indicator.appendChild(badge);
					});
					discussion.appendChild(indicator);
				}
			});
			// Inject enhanced animation keyframes
			if (!document.getElementById('mod-tag-animation-enhanced-style')) {
				const style = document.createElement('style');
				style.id = 'mod-tag-animation-enhanced-style';
				style.textContent = `
            @keyframes fadeInTagEnhanced {
                from {
                    opacity: 0;
                    transform: translateY(6px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            @keyframes popIn {
                0% {
                    opacity: 0;
                    transform: scale(0.8) translateY(8px);
                }
                70% {
                    transform: scale(1.05) translateY(-2px);
                }
                100% {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }
            @keyframes shimmer {
                0% { left: -100%; }
                100% { left: 100%; }
            }
            .beatmap-discussion__top:hover {
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                transform: translateY(-1px);
            }
        `;
				document.head.appendChild(style);
			}
		}
		static detectFillerWords(text) {
			const words = text.toLowerCase().split(/\s+/);
			return [...new Set(words.filter(w => FILLER_WORDS.has(w)))];
		}
		static async checkGrammar(text) {
			if (!text || text.length < 3) return {
				matches: []
			};
			try {
				const response = await new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: 'POST',
						url: WORDING_CONFIG.APIS.LANGUAGETOOL,
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded'
						},
						data: `text=${encodeURIComponent(text)}&language=en-US`,
						onload: (response) => {
							try {
								resolve(JSON.parse(response.responseText));
							} catch (e) {
								reject(e);
							}
						},
						onerror: reject,
						ontimeout: reject,
						timeout: 10000
					});
				});
				return {
					matches: response.matches?.slice(0, 10) || []
				};
			} catch (error) {
				console.warn('Grammar check failed:', error);
				return {
					matches: []
				};
			}
		}
	}
	class VocabularyService {
		constructor() {
			this.cache = new WordingCacheManager();
		}
		async getDefinition(word) {
			const cacheKey = `def_${word}`;
			const cached = this.cache.get(cacheKey);
			if (cached) return cached;
			try {
				const response = await this.makeRequest(
					`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
				);
				if (response?.[0]) {
					const meanings = response[0].meanings || [];
					const synonyms = [];
					meanings.forEach(m => m.synonyms && synonyms.push(...m.synonyms));
					const result = {
						word: response[0].word,
						phonetic: response[0].phonetic,
						definitions: meanings.map(m => ({
							partOfSpeech: m.partOfSpeech,
							definition: m.definitions[0]?.definition
						})),
						synonyms: [...new Set(synonyms)].slice(0, 20)
					};
					this.cache.set(cacheKey, result);
					return result;
				}
			} catch (error) {
				console.warn('Dictionary API failed:', error);
			}
			return null;
		}
		async getSynonyms(word) {
			return this.fetchDatamuse(word, 'syn', 'rel_syn');
		}
		async getSimilar(word) {
			return this.fetchDatamuse(word, 'sim', 'ml', word);
		}
		async getRhymes(word) {
			return this.fetchDatamuse(word, 'rhyme', 'rel_rhy', null, 20);
		}
		async getFollowing(word) {
			return this.fetchDatamuse(word, 'follow', 'lc', null, 20);
		}
		async getAdjectives(word) {
			return this.fetchDatamuse(word, 'adj', 'rel_jjb', null, 20);
		}
		async getAssociations(word) {
			return this.fetchDatamuse(word, 'assoc', 'rel_trg', null, 20);
		}
		async fetchDatamuse(word, cachePrefix, param, excludeSelf = null, max = 30) {
			const cacheKey = `${cachePrefix}_${word}`;
			const cached = this.cache.get(cacheKey);
			if (cached) return cached;
			try {
				const response = await this.makeRequest(
					`https://api.datamuse.com/words?${param}=${encodeURIComponent(word)}&max=${max}`
				);
				const filtered = response
					.filter(item => !this.isVulgar(item.word) && (excludeSelf === null || item.word !== excludeSelf))
					.map(item => ({
						word: item.word,
						score: item.score || 0,
						source: cachePrefix === 'syn' || cachePrefix === 'sim' ? 'datamuse' : cachePrefix
					}))
					.sort((a, b) => b.score - a.score);
				this.cache.set(cacheKey, filtered);
				return filtered;
			} catch (error) {
				return cachePrefix === 'syn' || cachePrefix === 'sim' ? this.getFallback(word) : [];
			}
		}
		getFallback(word) {
			const lower = word.toLowerCase();
			if (OSU_MANIA_VOCAB[lower]) {
				return OSU_MANIA_VOCAB[lower].map((w, i) => ({
					word: w,
					score: 100 - (i * 5),
					source: 'osu-vocab'
				}));
			}
			if (FALLBACK_VOCAB[lower]) {
				return FALLBACK_VOCAB[lower].map((w, i) => ({
					word: w,
					score: 100 - (i * 10),
					source: 'fallback'
				}));
			}
			return [];
		}
		isVulgar(word) {
			return VULGAR_TERMS.has(word.toLowerCase());
		}
		makeRequest(url) {
			return new Promise((resolve, reject) => {
				GM_xmlhttpRequest({
					method: 'GET',
					url,
					onload: (response) => {
						try {
							resolve(JSON.parse(response.responseText));
						} catch (e) {
							reject(e);
						}
					},
					onerror: reject,
					ontimeout: reject,
					timeout: 8000
				});
			});
		}
	}
	// WORDING HELPER MANAGER
	class WordingHelperManager {
		static vocabService = new VocabularyService();
		static currentWord = null;
		static currentSentence = null;
		static updateTimers = new Map();
		static lastAnalysisHash = null;
		static showWordingPanel() {
			let panel = document.getElementById('wording-helper-panel');
			if (panel) {
				panel.remove();
				this.cleanupTimers();
				return;
			}
			panel = Utils.createElement('div');
			panel.id = 'wording-helper-panel';
			panel.className = 'floating-panel';
			panel.style.cssText = 'width: 340px; max-height: 600px;';
			panel.innerHTML = `
<button class="panel-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 1;">×</button>
<div class="panel-content" style="padding-top: 20px;">
    <div style="text-align: center; margin-bottom: 16px; font-size: 14px; color: #eee; font-weight: 600;">
        <i class="fas fa-spell-check"></i> Wording Helper
    </div>
    <div style="display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); flex-wrap: wrap;">
        <button class="wording-tab active" data-tab="suggestions" style="flex: 1; min-width: 50px; background: rgba(255, 255, 255, 0.1); border: none; color: #fff; padding: 6px 8px; cursor: pointer; font-size: 9px; border-radius: 4px 4px 0 0; transition: all 0.15s ease;">Synonyms</button>
        <button class="wording-tab" data-tab="structure" style="flex: 1; min-width: 50px; background: rgba(26, 26, 26, 0.6); border: none; color: rgba(255, 255, 255, 0.7); padding: 6px 8px; cursor: pointer; font-size: 9px; border-radius: 4px 4px 0 0; transition: all 0.15s ease;">Structure</button>
        <button class="wording-tab" data-tab="analysis" style="flex: 1; min-width: 50px; background: rgba(26, 26, 26, 0.6); border: none; color: rgba(255, 255, 255, 0.7); padding: 6px 8px; cursor: pointer; font-size: 9px; border-radius: 4px 4px 0 0; transition: all 0.15s ease;">Analysis</button>
    </div>
    <div class="wording-tab-content" data-content="suggestions" style="display: block;">
        <div style="margin-bottom: 12px;">
            <input type="text" id="word-input" placeholder="Type or double-click a word..." style="width: 100%; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.08); color: #fff; padding: 8px 10px; border-radius: 4px; font-size: 11px; box-sizing: border-box;">
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 12px;">
            <button id="get-synonyms" class="feature-btn" style="flex: 1; padding: 6px 10px;">Synonyms</button>
            <button id="get-similar" class="feature-btn" style="flex: 1; padding: 6px 10px;">Similar</button>
        </div>
        <div id="suggestions-container" style="max-height: 400px; overflow-y: auto;">
            <div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">
                Enter a word or double-click one in your text
            </div>
        </div>
    </div>
    <div class="wording-tab-content" data-content="structure" style="display: none;">
        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.4); text-align: center; margin-bottom: 12px; font-style: italic;">
            Analyzing active textarea • Live updates
        </div>
        <div id="structure-results" style="max-height: 350px; overflow-y: auto;">
            <div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">
                Enter feedback to check structure
            </div>
        </div>
    </div>
    <div class="wording-tab-content" data-content="analysis" style="display: none;">
        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.4); text-align: center; margin-bottom: 12px; font-style: italic;">
            Grammar, Readability, Tone Analysis
        </div>
        <div id="analysis-results" style="max-height: 450px; overflow-y: auto;">
            <div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">
                Type feedback to see analysis...
            </div>
        </div>
    </div>
</div>
`;
			document.body.appendChild(panel);
			UI.makeDraggable(panel, panel);
			this.setupEventListeners(panel);
			this.attachDoubleClickListener();
		}
		static setupEventListeners(panel) {
			const closeBtn = panel.querySelector('.panel-close');
			closeBtn.addEventListener('click', () => {
				panel.remove();
				this.cleanupTimers();
			});
			closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
			this.setupTabSwitching(panel);
			panel.querySelector('#get-synonyms')?.addEventListener('click', () => this.getSuggestions('synonyms', panel));
			panel.querySelector('#get-similar')?.addEventListener('click', () => this.getSuggestions('similar', panel));
			this.setupStructureAnalysis(panel);
			this.setupFullAnalysis(panel);
			panel.querySelectorAll('input, textarea, button').forEach(el => {
				el.addEventListener('mousedown', (e) => e.stopPropagation());
			});
		}
		static setupTabSwitching(panel) {
			const tabs = panel.querySelectorAll('.wording-tab');
			const contents = panel.querySelectorAll('.wording-tab-content');
			tabs.forEach(tab => {
				tab.addEventListener('click', () => {
					const targetTab = tab.dataset.tab;
					tabs.forEach(t => {
						t.style.background = 'rgba(26, 26, 26, 0.6)';
						t.style.color = 'rgba(255, 255, 255, 0.7)';
						t.classList.remove('active');
					});
					contents.forEach(c => {
						c.style.display = c.dataset.content === targetTab ? 'block' : 'none';
					});
					tab.style.background = 'rgba(255, 255, 255, 0.1)';
					tab.style.color = '#fff';
					tab.classList.add('active');
					this.handleTabActivation(targetTab, panel);
				});
				tab.addEventListener('mousedown', (e) => e.stopPropagation());
			});
		}
		static handleTabActivation(tabName, panel) {
			const textarea = TextEditor.findActiveTextarea();
			if (!textarea?.value) return;
			switch (tabName) {
				case 'structure':
					this.scheduleStructureUpdate(panel, textarea.value);
					break;
				case 'analysis':
					this.scheduleFullAnalysis(panel, textarea.value);
					break;
			}
		}
		static setupStructureAnalysis(panel) {
			const updateStructure = () => {
				const textarea = TextEditor.findActiveTextarea();
				if (textarea?.value) {
					this.scheduleStructureUpdate(panel, textarea.value);
				} else {
					this.showEmptyStructureState(panel);
				}
			};
			const inputHandler = (e) => {
				if (e.target?.tagName === 'TEXTAREA') {
					this.scheduleStructureUpdate(panel, e.target.value);
				}
			};
			['input', 'keyup', 'change'].forEach(evt =>
				document.addEventListener(evt, inputHandler, true)
			);
			setTimeout(updateStructure, 300);
		}
		static setupFullAnalysis(panel) {
			const updateAnalysis = () => {
				const textarea = TextEditor.findActiveTextarea();
				if (textarea?.value) {
					this.scheduleFullAnalysis(panel, textarea.value);
				} else {
					this.showEmptyAnalysisState(panel);
				}
			};
			const inputHandler = (e) => {
				if (e.target?.tagName === 'TEXTAREA') {
					this.scheduleFullAnalysis(panel, e.target.value);
				}
			};
			['input', 'keyup'].forEach(evt =>
				document.addEventListener(evt, inputHandler, true)
			);
		}
		static scheduleStructureUpdate(panel, text) {
			this.clearTimer('structure');
			const timerId = setTimeout(() => {
				this.analyzeStructure(panel, text);
			}, 300);
			this.updateTimers.set('structure', timerId);
		}
		static scheduleFullAnalysis(panel, text) {
			this.clearTimer('analysis');
			const hash = this.hashString(text);
			if (hash === this.lastAnalysisHash) return;
			const timerId = setTimeout(async () => {
				this.lastAnalysisHash = hash;
				await this.analyzeFullText(panel, text);
			}, 800);
			this.updateTimers.set('analysis', timerId);
		}
		static clearTimer(name) {
			const timerId = this.updateTimers.get(name);
			if (timerId) {
				clearTimeout(timerId);
				this.updateTimers.delete(name);
			}
		}
		static cleanupTimers() {
			this.updateTimers.forEach(timerId => clearTimeout(timerId));
			this.updateTimers.clear();
			this.lastAnalysisHash = null;
		}
		static hashString(str) {
			let hash = 0;
			for (let i = 0; i < str.length; i++) {
				const char = str.charCodeAt(i);
				hash = ((hash << 5) - hash) + char;
				hash = hash & hash;
			}
			return hash;
		}
		static showEmptyStructureState(panel) {
			const container = panel.querySelector('#structure-results');
			if (container) {
				container.innerHTML = '<div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">Type in a textarea to see analysis...</div>';
			}
		}
		static showEmptyAnalysisState(panel) {
			const container = panel.querySelector('#analysis-results');
			if (container) {
				container.innerHTML = '<div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">Type feedback to see analysis...</div>';
			}
		}
		static attachDoubleClickListener() {
			document.addEventListener('mouseup', (e) => {
				if (e.target.tagName !== 'TEXTAREA') return;
				const textarea = e.target;
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				if (start === end) return;
				const selectedText = textarea.value.substring(start, end).trim();
				if (selectedText && selectedText.length > 2 && !selectedText.includes(' ')) {
					this.currentWord = selectedText;
					const panel = document.getElementById('wording-helper-panel');
					if (!panel) {
						this.showWordingPanel();
					}
					setTimeout(() => {
						const input = document.getElementById('word-input');
						if (input) {
							input.value = selectedText;
							this.getSuggestions('synonyms', document.getElementById('wording-helper-panel'));
						}
					}, 100);
				}
			});
		}
		static async getSuggestions(type, panel) {
			const input = panel.querySelector('#word-input');
			const word = input?.value?.trim();
			if (!word) {
				UI.showNotification('Enter a word first', 'warning');
				return;
			}
			const container = panel.querySelector('#suggestions-container');
			container.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 32px;"></i></div>';
			try {
				const results = type === 'synonyms' ?
					await this.vocabService.getSynonyms(word) :
					await this.vocabService.getSimilar(word);
				if (results.length === 0) {
					container.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255, 255, 255, 0.5);">No suggestions found</div>';
					return;
				}
				this.renderSuggestions(container, results);
			} catch (error) {
				container.innerHTML = '<div style="text-align: center; padding: 40px; color: #ff6b6b;">Failed to fetch suggestions</div>';
			}
		}
		static renderSuggestions(container, results) {
			container.innerHTML = results.slice(0, 15).map(item => `
                        <div class="suggestion-item" data-word="${Utils.sanitizeHTML(item.word)}" style="background: rgba(26, 26, 26, 0.6); border-radius: 4px; padding: 10px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s ease;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="color: rgba(255, 255, 255, 0.9); font-size: 12px; font-weight: 500;">${Utils.sanitizeHTML(item.word)}</span>
                                        <div style="display: flex; gap: 6px; align-items: center;">
                                                ${item.source === 'fallback' || item.source === 'osu-vocab' ? '<span style="font-size: 9px; color: rgba(255, 255, 255, 0.4); background: rgba(255, 255, 255, 0.08); padding: 2px 6px; border-radius: 8px;">OFFLINE</span>' : ''}
                                                <span style="font-size: 9px; color: rgba(255, 255, 255, 0.5); background: rgba(255, 255, 255, 0.08); padding: 2px 6px; border-radius: 8px;">${Math.round(item.score)}</span>
                                        </div>
                                </div>
                        </div>
                `).join('');
			container.querySelectorAll('.suggestion-item').forEach(item => {
				item.addEventListener('click', () => this.insertWord(item.dataset.word));
				item.addEventListener('mouseenter', () => item.style.background = 'rgba(255, 255, 255, 0.12)');
				item.addEventListener('mouseleave', () => item.style.background = 'rgba(26, 26, 26, 0.6)');
			});
		}
		static insertWord(word) {
			const textarea = TextEditor.findActiveTextarea();
			if (textarea) {
				TextEditor.insertTextAtCursor(textarea, word);
				UI.showNotification('Word inserted!', 'success');
			} else {
				navigator.clipboard.writeText(word);
				UI.showNotification('Word copied to clipboard!', 'success');
			}
		}
		static async analyzeFullText(panel, text) {
			const container = panel.querySelector('#analysis-results');
			if (!container || !text || text.trim().length < 10) {
				this.showEmptyAnalysisState(panel);
				return;
			}
			container.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 32px;"></i></div>';
			const [grammar, readability, sentiment, passive, repetition, fillers] = await Promise.all([
				TextAnalyzer.checkGrammar(text),
				Promise.resolve(TextAnalyzer.calculateReadability(text)),
				Promise.resolve(TextAnalyzer.analyzeSentiment(text)),
				Promise.resolve(TextAnalyzer.detectPassiveVoice(text)),
				Promise.resolve(TextAnalyzer.detectRepetition(text)),
				Promise.resolve(TextAnalyzer.detectFillerWords(text))
			]);
			this.renderAnalysisResults(container, {
				grammar,
				readability,
				sentiment,
				passive,
				repetition,
				fillers
			});
		}
		static renderAnalysisResults(container, data) {
			const {
				grammar,
				readability,
				sentiment,
				passive,
				repetition,
				fillers
			} = data;
			const totalIssues = grammar.matches.length + passive.length +
				(repetition.length > 0 ? 1 : 0) + (fillers.length > 0 ? 1 : 0);
			const readabilityColor = readability.score >= 60 ? '#4caf50' :
				readability.score >= 40 ? '#ffd93d' : '#ff6b6b';
			const sentimentColor = sentiment.sentiment === 'positive' ? '#4caf50' :
				sentiment.sentiment === 'very negative' ? '#ff6b6b' :
				sentiment.sentiment === 'negative' ? '#ffd93d' : '#6bb6ff';
			container.innerHTML = `
<div style="background: rgba(26, 26, 26, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 12px; margin-bottom: 12px;">
    <div style="text-align: center; margin-bottom: 12px;">
        <div style="font-size: 24px; font-weight: 700; color: ${totalIssues === 0 ? '#4caf50' : totalIssues <= 2 ? '#ffd93d' : '#ff6b6b'};">${totalIssues}</div>
        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.5);">Issues Found</div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 10px;">
        <div style="text-align: center; padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 3px;">
            <div style="color: ${readabilityColor}; font-weight: 600;">${readability.level}</div>
            <div style="color: rgba(255, 255, 255, 0.5);">Readability</div>
        </div>
        <div style="text-align: center; padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 3px;">
            <div style="color: ${sentimentColor}; font-weight: 600; text-transform: capitalize;">${sentiment.sentiment}</div>
            <div style="color: rgba(255, 255, 255, 0.5);">Tone</div>
        </div>
        <div style="text-align: center; padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 3px;">
            <div style="color: #6bb6ff; font-weight: 600;">Grade ${readability.grade}</div>
            <div style="color: rgba(255, 255, 255, 0.5);">Reading Level</div>
        </div>
        <div style="text-align: center; padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 3px;">
            <div style="color: ${grammar.matches.length === 0 ? '#4caf50' : '#ff6b6b'}; font-weight: 600;">${grammar.matches.length}</div>
            <div style="color: rgba(255, 255, 255, 0.5);">Grammar</div>
        </div>
    </div>
</div>
${this.renderGrammarIssues(grammar, totalIssues === 0 && sentiment.sentiment === 'neutral')}
${this.renderSentimentWarning(sentiment)}
${this.renderPassiveVoice(passive)}
${this.renderRepetition(repetition)}
${this.renderFillers(fillers)}
${totalIssues === 0 && sentiment.sentiment === 'neutral' ? this.renderSuccessMessage() : ''}
`;
		}
		static renderGrammarIssues(grammar, showSuccess) {
			if (grammar.matches.length === 0 && !showSuccess) return '';
			return grammar.matches.length > 0 ? `
<div style="margin-bottom: 12px;">
    <div style="font-size: 11px; color: #ff6b6b; font-weight: 600; margin-bottom: 8px;">
        <i class="fas fa-exclamation-circle"></i> Grammar & Spelling (${grammar.matches.length})
    </div>
    ${grammar.matches.slice(0, 5).map(match => `
        <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 4px; padding: 8px; margin-bottom: 6px;">
            <div style="font-size: 10px; color: rgba(255, 255, 255, 0.9); margin-bottom: 4px;">
                "${Utils.sanitizeHTML(match.context?.text || match.sentence || '')}"
            </div>
            <div style="font-size: 9px; color: rgba(255, 255, 255, 0.7);">${match.message}</div>
            ${match.replacements?.length > 0 ? `
                <div style="font-size: 9px; color: #4caf50; margin-top: 4px;">
                    → Suggestion: ${match.replacements.slice(0, 3).map(r => r.value).join(', ')}
                </div>
            ` : ''}
        </div>
    `).join('')}
    ${grammar.matches.length > 5 ? `<div style="font-size: 9px; color: rgba(255, 255, 255, 0.5); text-align: center; margin-top: 6px;">+${grammar.matches.length - 5} more issues</div>` : ''}
</div>
` : '';
		}
		static renderSentimentWarning(sentiment) {
			if (sentiment.sentiment !== 'very negative' && sentiment.sentiment !== 'negative') return '';
			return `
<div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 4px; padding: 10px; margin-bottom: 12px;">
    <div style="font-size: 11px; color: #ff6b6b; font-weight: 600; margin-bottom: 4px;">
        <i class="fas fa-frown"></i> ${sentiment.sentiment === 'very negative' ? 'Very Negative Tone Detected' : 'Negative Tone'}
    </div>
    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.8);">
        ${sentiment.harshCount > 0 ? 'Contains harsh language. ' : ''}Consider rephrasing to be more constructive.
    </div>
</div>
`;
		}
		static renderPassiveVoice(passive) {
			if (passive.length === 0) return '';
			return `
<div style="margin-bottom: 12px;">
    <div style="font-size: 11px; color: #ffd93d; font-weight: 600; margin-bottom: 8px;">
        <i class="fas fa-exchange-alt"></i> Passive Voice (${passive.length})
    </div>
    <div style="background: rgba(255, 217, 61, 0.1); border: 1px solid rgba(255, 217, 61, 0.3); border-radius: 4px; padding: 8px;">
        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.9); margin-bottom: 4px;">
            ${passive.slice(0, 3).map(p => `"${Utils.sanitizeHTML(p)}"`).join(', ')}
        </div>
        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.7);">Use active voice for clearer, more direct feedback</div>
    </div>
</div>
`;
		}
		static renderRepetition(repetition) {
			if (repetition.length === 0) return '';
			return `
<div style="margin-bottom: 12px;">
    <div style="font-size: 11px; color: #ffd93d; font-weight: 600; margin-bottom: 8px;">
        <i class="fas fa-redo"></i> Repetitive Words
    </div>
    <div style="background: rgba(255, 217, 61, 0.1); border: 1px solid rgba(255, 217, 61, 0.3); border-radius: 4px; padding: 8px;">
        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.9);">
            ${repetition.map(([word, count]) => `<span style="margin-right: 8px;">"${word}" (${count}×)</span>`).join('')}
        </div>
        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.7); margin-top: 4px;">Consider using synonyms for variety</div>
    </div>
</div>
`;
		}
		static renderFillers(fillers) {
			if (fillers.length === 0) return '';
			return `
<div style="margin-bottom: 12px;">
    <div style="font-size: 11px; color: #6bb6ff; font-weight: 600; margin-bottom: 8px;">
        <i class="fas fa-comment-slash"></i> Filler Words
    </div>
    <div style="background: rgba(107, 182, 255, 0.1); border: 1px solid rgba(107, 182, 255, 0.3); border-radius: 4px; padding: 8px;">
        <div style="font-size: 10px; color: rgba(255, 255, 255, 0.9);">${fillers.join(', ')}</div>
        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.7); margin-top: 4px;">These words often add no value - consider removing</div>
    </div>
</div>
`;
		}
		static renderSuccessMessage() {
			return `
<div style="text-align: center; padding: 30px; color: #4caf50;">
    <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
    <p style="font-size: 12px; font-weight: 600;">Excellent writing quality!</p>
    <p style="font-size: 10px; color: rgba(255, 255, 255, 0.6); margin-top: 4px;">Clear, professional feedback</p>
</div>
`;
		}
		static analyzeStructure(panel, sentenceText = null) {
			const textarea = TextEditor.findActiveTextarea();
			const sentence = sentenceText || textarea?.value?.trim();
			if (!sentence) {
				const container = panel.querySelector('#structure-results');
				if (container) container.innerHTML = '<div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">Type in a textarea to see analysis...</div>';
				return;
			}
			const container = panel.querySelector('#structure-results');
			if (!container) return;
			const sentences = sentence.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
			if (sentences.length === 0) {
				container.innerHTML = '<div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.5); font-size: 11px;">No feedback structure detected. Write actual feedback about mapping.</div>';
				return;
			}
			const hasVulgar = (sent) => Array.from(VULGAR_TERMS).some(v => new RegExp(`\\b${v}\\b`, 'gi').test(sent));
			const clean = (text) => text.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
			const whatCandidates = [];
			sentences.forEach(sent => {
				if (hasVulgar(sent)) return;
				const ts = sent.match(/(\d{1,2}:\d{2}:\d{3}[^.!?]*)/);
				if (ts) whatCandidates.push(ts[1].trim());
				const demo = sent.match(/\b(this|that|these|those)\s+([^,;.!?]+?)(?=\s+(?:is|are|feels?|seems?|looks?|doesn't|makes?|causes?|should|could|would|,|;|\.|$))/i);
				if (demo) whatCandidates.push(demo[0].trim());
				const elem = sent.match(/\b(pattern|note|section|ln|chord|jump|trill|jack|stream|anchor|timing|hitsound|snap|object|placement|map|difficulty|diff|drum|roll)s?\b[^.!?]{0,30}/i);
				if (elem && !demo) whatCandidates.push(elem[0].trim());
			});
			const whyCandidates = [];
			sentences.forEach(sent => {
				if (hasVulgar(sent)) return;
				const causal = sent.match(/\b(because|since|as|given that)\s+([^.!?]+)/i);
				if (causal) whyCandidates.push(causal[0].trim());
				const feel = sent.match(/\b(feels?|sounds?|is|are|seems?)\s+(awkward|off|wrong|uncomfortable|confusing|hard|difficult|weird|strange|inconsistent|unnatural|not\s+aligned|missnapped|overmapped|clunky|forced|jarring|abrupt|unclear|messy|overloaded|random)[^.!?]*/i);
				if (feel) whyCandidates.push(feel[0].trim());
				const effect = sent.match(/\b(makes?|causes?|results?\s+in|leads?\s+to)\s+([^.!?]+(?:awkward|hard|difficult|confusing|uncomfortable|unclear|inconsistent|unnatural|problematic|challenging))/i);
				if (effect) whyCandidates.push(effect[0].trim());
				const breakm = sent.match(/\b(breaks?|disrupts?|conflicts?\s+with|contradicts?|clashes?\s+with)\s+([^.!?]+)/i);
				if (breakm) whyCandidates.push(breakm[0].trim());
				const lack = sent.match(/\b(lacks?|missing|needs?|could\s+use)\s+([^.!?]+)/i);
				if (lack) whyCandidates.push(lack[0].trim());
			});
			const howCandidates = [];
			sentences.forEach(sent => {
				if (hasVulgar(sent)) return;
				const isVague = /\b(better|improve|fix|change it|something|anything)\b/i.test(sent) && !/\b(try|consider|use|add|remove|move|replace|remap|adjust|simplify|emphasize|reduce|increase|snap|map|place|shift|going|using|adding|spacing|rhythm|direction)\s+\w+/i.test(sent);
				if (isVague) return;
				const tryM = sent.match(/\b(try|consider)\s+(going|using|adding|removing|replacing|moving|mapping|making|spacing|snapping)\s+([^.!?]{5,})/i);
				if (tryM) howCandidates.push(tryM[0].trim());
				const couldM = sent.match(/\b(you could|could)\s+([^.!?]+)\s+by\s+([^.!?]+)/i);
				if (couldM) howCandidates.push(couldM[0].trim());
				const betterM = sent.match(/\b(would be|should be|could be)\s+(better|clearer|easier|more\s+\w+)\s+(if|to|by)\s+([^.!?]+)/i);
				if (betterM) howCandidates.push(betterM[0].trim());
				const actionM = sent.match(/\b(try|consider|suggest|recommend)\s+(using|adding|removing|replacing|moving|adjusting|simplifying|emphasizing|reducing|mapping)\s+([^.!?]{10,})/i);
				if (actionM) howCandidates.push(actionM[0].trim());
				const directM = sent.match(/\b(use|add|remove|move|replace|remap|resnap|shift|snap|adjust|simplify|emphasize|map|space|place|give)\s+([^.!?]{8,})/i);
				if (directM && directM[2].split(' ').length >= 3) howCandidates.push(directM[0].trim());
				const insteadM = sent.match(/\b(instead of|rather than)\s+([^,]+),?\s+(use|try|consider|map|go)\s+([^.!?]+)/i);
				if (insteadM) howCandidates.push(insteadM[0].trim());
			});
			const hasImages = /!\[.*?\]\(.*?\)|https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|webp)/i.test(sentence);
			if (hasImages) howCandidates.push("Visual reference or screenshot provided");
			const whatFragments = [...new Set(whatCandidates.map(clean))].slice(0, 2);
			const whyFragments = [...new Set(whyCandidates.map(clean))].slice(0, 2);
			const howFragments = [...new Set(howCandidates.map(clean))].slice(0, 3);
			const hasWhat = whatFragments.length > 0;
			const hasWhy = whyFragments.length > 0;
			const hasHow = howFragments.length > 0;
			const vulgarTermsFound = [];
			VULGAR_TERMS.forEach(v => {
				if (new RegExp(`\\b${v}\\b`, 'gi').test(sentence)) vulgarTermsFound.push(v);
			});
			const weakWordsFound = [];
			WEAK_WORDS.forEach(w => {
				if (new RegExp(`\\b${w}\\b`, 'gi').test(sentence)) weakWordsFound.push(w);
			});
			let totalScore = (hasWhat ? 33 : 0) + (hasWhy ? 33 : 0) + (hasHow ? 34 : 0);
			if (vulgarTermsFound.length > 0) totalScore = Math.max(0, totalScore - 50);
			const scoreColor = totalScore >= 90 ? '#4caf50' : totalScore >= 60 ? '#ffd93d' : '#ff6b6b';
			container.innerHTML = `
${vulgarTermsFound.length > 0 ? `
<div style="background: rgba(255, 107, 107, 0.15); border: 2px solid rgba(255, 107, 107, 0.5); border-radius: 4px; padding: 12px; margin-bottom: 14px;">
    <div style="font-size: 12px; color: #ff6b6b; font-weight: 700; margin-bottom: 6px;">
        <i class="fas fa-exclamation-triangle"></i> Inappropriate Language Detected
    </div>
    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.9); margin-bottom: 8px;">
        Found: <strong>${vulgarTermsFound.join(', ')}</strong>
    </div>
    <div style="font-size: 9px; color: rgba(255, 255, 255, 0.7); line-height: 1.4;">
        Professional feedback should avoid profanity. Consider rephrasing to maintain a respectful tone.
    </div>
</div>
` : ''}
<div style="background: rgba(26, 26, 26, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 12px; margin-bottom: 12px;">
    <div style="font-size: 11px; color: #eee; margin-bottom: 8px; font-weight: 600; text-align: center;">Feedback Structure Analysis</div>
    <div style="text-align: center; margin-bottom: 12px;">
        <div style="font-size: 24px; font-weight: 700; color: ${scoreColor};">${totalScore}%</div>
        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.5);">Completeness Score</div>
    </div>
    <div style="padding: 12px;">
        <div style="background: rgba(${hasWhat ? '76, 175, 80' : '255, 107, 107'}, 0.15); border: 2px solid rgba(${hasWhat ? '76, 175, 80' : '255, 107, 107'}, 0.4); border-radius: 6px; padding: 10px; margin-bottom: 10px;">
            <div style="font-size: 11px; color: ${hasWhat ? '#4caf50' : '#ff6b6b'}; font-weight: 700; margin-bottom: 6px;">
                ${hasWhat ? '✓' : '✗'} WHAT - Identify the Issue
            </div>
            ${whatFragments.length > 0 ? whatFragments.map(f => `
                <div style="background: rgba(0, 0, 0, 0.3); border-radius: 3px; padding: 6px 8px; margin-bottom: 4px;">
                    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.85); line-height: 1.4;">"${Utils.sanitizeHTML(f)}"</div>
                </div>
            `).join('') : `
                <div style="font-size: 9px; color: rgba(255, 255, 255, 0.5); font-style: italic;">No specific issue identified - use timestamps, "this note/pattern"</div>
            `}
        </div>
        <div style="background: rgba(${hasWhy ? '76, 175, 80' : '255, 107, 107'}, 0.15); border: 2px solid rgba(${hasWhy ? '76, 175, 80' : '255, 107, 107'}, 0.4); border-radius: 6px; padding: 10px; margin-bottom: 10px;">
            <div style="font-size: 11px; color: ${hasWhy ? '#4caf50' : '#ff6b6b'}; font-weight: 700; margin-bottom: 6px;">
                ${hasWhy ? '✓' : '✗'} WHY - Explain the Problem
            </div>
            ${whyFragments.length > 0 ? whyFragments.map(f => `
                <div style="background: rgba(0, 0, 0, 0.3); border-radius: 3px; padding: 6px 8px; margin-bottom: 4px;">
                    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.85); line-height: 1.4;">"${Utils.sanitizeHTML(f)}"</div>
                </div>
            `).join('') : `
                <div style="font-size: 9px; color: rgba(255, 255, 255, 0.5); font-style: italic;">No explanation - explain why it feels awkward, confusing, or doesn't fit</div>
            `}
        </div>
        <div style="background: rgba(${hasHow ? '76, 175, 80' : '255, 107, 107'}, 0.15); border: 2px solid rgba(${hasHow ? '76, 175, 80' : '255, 107, 107'}, 0.4); border-radius: 6px; padding: 10px;">
            <div style="font-size: 11px; color: ${hasHow ? '#4caf50' : '#ff6b6b'}; font-weight: 700; margin-bottom: 6px;">
                ${hasHow ? '✓' : '✗'} HOW - Suggest Solution
            </div>
            ${howFragments.length > 0 ? howFragments.map(f => `
                <div style="background: rgba(0, 0, 0, 0.3); border-radius: 3px; padding: 6px 8px; margin-bottom: 4px;">
                    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.85); line-height: 1.4;">"${Utils.sanitizeHTML(f)}"</div>
                </div>
            `).join('') : `
                <div style="font-size: 9px; color: rgba(255, 255, 255, 0.5); font-style: italic;">No solution - suggest specific changes or remapping</div>
            `}
        </div>
    </div>
</div>
${!hasWhat || !hasWhy || !hasHow ? `
<div style="padding: 12px;">
    ${!hasWhat ? `
        <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 4px; padding: 10px; margin-bottom: 8px;">
            <div style="font-size: 11px; color: #ff6b6b; font-weight: 600; margin-bottom: 2px;">Missing: WHAT</div>
            <div style="font-size: 10px; color: rgba(255, 255, 255, 0.8);">Add specific timestamps or "this pattern/note"</div>
        </div>
    ` : ''}
    ${!hasWhy ? `
        <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 4px; padding: 10px; margin-bottom: 8px;">
            <div style="font-size: 11px; color: #ff6b6b; font-weight: 600; margin-bottom: 2px;">Missing: WHY</div>
            <div style="font-size: 10px; color: rgba(255, 255, 255, 0.8);">Explain why it's problematic (feels awkward, breaks flow, etc.)</div>
        </div>
    ` : ''}
    ${!hasHow ? `
        <div style="background: rgba(255, 107, 107, 0.1); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 4px; padding: 10px; margin-bottom: 8px;">
            <div style="font-size: 11px; color: #ff6b6b; font-weight: 600; margin-bottom: 2px;">Missing: HOW</div>
            <div style="font-size: 10px; color: rgba(255, 255, 255, 0.8);">Suggest how to fix it (try X, use Y, remap to Z)</div>
        </div>
    ` : ''}
</div>
` : `
<div style="text-align: center; padding: 30px; color: #4caf50;">
    <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
    <p style="font-size: 12px; font-weight: 600;">Excellent feedback structure!</p>
</div>
`}
${weakWordsFound.length > 0 ? `
<div style="background: rgba(255, 217, 61, 0.1); border: 1px solid rgba(255, 217, 61, 0.3); border-radius: 4px; padding: 10px;">
    <div style="font-size: 11px; color: #ffd93d; font-weight: 600; margin-bottom: 4px;">Weak Words Detected</div>
    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.8);">${weakWordsFound.slice(0, 8).join(', ')}</div>
</div>
` : ''}
`;
		}
	}
	// BEATMAP PREVIEW PLAYER
	class BeatmapPreviewPlayer {
		constructor(autoLoad = false) {
			this.beatmapData = null;
			this.isPlaying = false;
			this.currentTime = 0;
			this.startPlayTime = 0;
			this.animationFrame = null;
			this.panel = null;
			this.canvas = null;
			this.ctx = null;
			this.scrollSpeed = 1.5;
			this.playbackRate = 1.0;
			this.noteHeight = 6;
			this.lnMinHeight = 20;
			this.highlightedNotes = null;
			this.densityIndicator = null;
			this.hitsoundEnabled = true;
			this.hitsoundVolume = 1;
			this.hitsound = new Audio('https://bei.s-ul.eu/LYZOTovv');
			this.hitsound.volume = this.hitsoundVolume;
			this.lastHitTime = -1000;
			this.musicAudio = null;
			this.musicVolume = 0.3;
			window.beatmapPreviewInstance = this;
			if (autoLoad) this.autoLoadAndShow();
		}
		async autoLoadAndShow() {
			const beatmapId = this.getCurrentBeatmapId();
			if (!beatmapId) return;
			if (this.beatmapData?.beatmapId !== beatmapId) {
				this.beatmapData = null;
			}
			try {
				const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
				if (!response.ok) return;
				const osuContent = await response.text();
				this.beatmapData = this.parseOsuContent(osuContent);
				this.beatmapData.beatmapId = beatmapId;
				this.currentTime = 0;
				this.createPanel();
				await this.loadCachedAudio();
			} catch (error) {
				debug.error('Auto-load failed:', error);
			}
		}
		getCurrentBeatmapId() {
			const hashMatch = window.location.hash.match(/#\w+\/(\d+)/);
			if (hashMatch) return hashMatch[1];
			const timelineMatch = window.location.pathname.match(/\/discussion\/(\d+)\/timeline/);
			if (timelineMatch) return timelineMatch[1];
			const discussionMatch = window.location.pathname.match(/\/discussion\/(\d+)/);
			return discussionMatch ? discussionMatch[1] : null;
		}
		async loadCachedAudio() {
			const match = window.location.pathname.match(/\/beatmapsets\/(\d+)/);
			if (!match) return;
			try {
				const audioData = await AudioAnalyzer.loadBeatmapAudio(match[1]);
				const blob = new Blob([audioData.data], {
					type: AudioAnalyzer.detectMimeType(audioData.data)
				});
				this.musicAudio = new Audio(URL.createObjectURL(blob));
				this.musicAudio.volume = this.musicVolume;
				debug.log('Cached audio loaded');
			} catch (error) {
				debug.log('No cached audio available');
			}
		}
		parseOsuContent(content) {
			const lines = content.split('\n');
			const data = {
				version: '',
				difficultyName: '',
				bpm: 120,
				hp: 5,
				od: 5,
				cs: 4,
				notes: [],
				timingPoints: []
			};
			let section = '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('[')) {
					section = trimmed;
					continue;
				}
				if (section === '[Metadata]' && trimmed.startsWith('Version:')) {
					data.version = data.difficultyName = trimmed.substring(8).trim();
				}
				if (section === '[Difficulty]') {
					if (trimmed.startsWith('HPDrainRate:')) {
						data.hp = parseFloat(trimmed.split(':')[1]);
					} else if (trimmed.startsWith('OverallDifficulty:')) {
						data.od = parseFloat(trimmed.split(':')[1]);
					} else if (trimmed.startsWith('CircleSize:')) {
						data.cs = parseInt(trimmed.split(':')[1]) || 4;
					}
				}
				if (section === '[TimingPoints]' && trimmed && !trimmed.startsWith('//')) {
					const parts = trimmed.split(',');
					if (parts.length >= 2) {
						const beatLength = parseFloat(parts[1]);
						if (beatLength > 0) {
							data.timingPoints.push({
								time: parseFloat(parts[0]),
								beatLength
							});
						}
					}
				}
				if (section === '[HitObjects]' && trimmed && !trimmed.startsWith('//')) {
					const parts = trimmed.split(',');
					if (parts.length < 4) continue;
					const x = parseInt(parts[0]);
					const time = parseInt(parts[2]);
					const type = parseInt(parts[3]);
					const col = Utils.clamp(Math.floor((x * data.cs) / 512), 0, data.cs - 1);
					if (type & 128) {
						const endTime = parseInt(parts[5].split(':')[0]);
						data.notes.push({
							time,
							col,
							endTime,
							length: endTime - time,
							isLN: true,
							id: Date.now() + Math.random()
						});
					} else {
						data.notes.push({
							time,
							col,
							endTime: null,
							isLN: false,
							id: Date.now() + Math.random()
						});
					}
				}
			}
			data.notes.sort((a, b) => a.time - b.time);
			if (data.timingPoints.length > 0) {
				data.bpm = Math.round(60000 / data.timingPoints[0].beatLength);
			}
			return data;
		}
		createPanel() {
			if (this.panel) this.panel.remove();
			this.panel = Utils.createElement('div');
			this.panel.id = 'beatmap-preview-player';
			this.panel.style.cssText = `
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 340px;
            height: 520px;
            background: rgba(12, 12, 12, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
            z-index: 10000;
            backdrop-filter: blur(10px);
        `;
			this.panel.innerHTML = `
            <button class="preview-close" style="position: absolute; top: 8px; right: 8px; background: none; border: none; color: rgba(255, 255, 255, 0.6); cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 3px; transition: all 0.2s ease; z-index: 10001;">×</button>
            <div style="position: relative;">
                <canvas id="preview-canvas" width="340" height="400" style="display: block; background: #000;"></canvas>
                <div class="density-scrollbar" id="density-scrollbar"></div>
                <div style="position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%); font-size: 9px; color: rgba(255, 255, 255, 0.3); pointer-events: none; text-align: center;">
                    Scroll: Wheel • Seek: Click • Select: Shift+Drag
                </div>
            </div>
            <div style="padding: 5px 8px; background: rgba(20, 20, 20, 0.9); border-top: 1px solid rgba(255, 255, 255, 0.1);">
                <div style="margin-bottom: 8px;">
                    <div style="display: flex; gap: 4px; margin-bottom: 6px;">
                        <input type="text" id="timestamp-input" placeholder="mm:ss:ms" style="flex: 1; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-family: monospace;">
                        <button id="jump-btn" style="flex: 0 0 50px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 4px; border-radius: 4px; cursor: pointer; font-size: 10px;">Jump</button>
                    </div>
                </div>
                <div style="display: flex; gap: 6px; margin-bottom: 8px; align-items: center;">
                    <button id="play-pause-btn" style="flex: 0 0 50px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 10px;">Play</button>
                    <button id="stop-btn" style="flex: 0 0 45px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 10px;">Stop</button>
                    <span id="time-display" style="font-size: 10px; color: rgba(255, 255, 255, 0.7); font-family: monospace; flex: 1; text-align: right;">0:00 / ${this.formatTimeSimple(this.getTotalDuration())}</span>
                </div>
                <div style="display: flex; gap: 6px; margin-bottom: 6px; align-items: flex-end;">
                    <div style="flex: 1;">
                        <label style="font-size: 8px; color: rgba(255, 255, 255, 0.5); display: block; margin-bottom: 1px;">Scroll</label>
                        <input type="range" id="scroll-speed-slider" min="0.5" max="3" step="0.1" value="1.5" style="width: 100%; height: 3px; background: rgba(255, 255, 255, 0.1); border-radius: 2px; outline: none; -webkit-appearance: none; cursor: pointer;">
                        <div style="font-size: 8px; color: rgba(255, 255, 255, 0.4); text-align: center;" id="scroll-speed-display">1.5x</div>
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 8px; color: rgba(255, 255, 255, 0.5); display: block; margin-bottom: 1px;">Rate</label>
                        <select id="playback-rate" style="width: 100%; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); color: #fff; padding: 3px; border-radius: 4px; font-size: 9px;">
                            <option value="0.25">0.25x</option>
                            <option value="0.5">0.5x</option>
                            <option value="0.75">0.75x</option>
                            <option value="1" selected>1.0x</option>
                            <option value="1.25">1.25x</option>
                            <option value="1.5">1.5x</option>
                        </select>
                    </div>
                </div>
                <div style="font-size: 8px; color: rgba(255, 255, 255, 0.5); text-align: center; line-height: 1.2; padding: 2px 0;">
                    <div>${this.beatmapData.cs}K • ${this.beatmapData.bpm} BPM • ${this.beatmapData.notes.length} notes</div>
                </div>
            </div>
        `;
			document.body.appendChild(this.panel);
			this.canvas = document.getElementById('preview-canvas');
			this.ctx = this.canvas.getContext('2d');
			this.canvas.style.cursor = 'move';
			UI.makeDraggable(this.panel, this.canvas, null);
			this.setupEventListeners();
			this.setupTimestampJumper();
			this.setupNoteSelection();
			this.renderDensityScrollbar();
			this.draw();
		}
		calculateDensity() {
			if (!this.beatmapData) return [];
			const windowSize = 1000;
			const totalDuration = this.getTotalDuration();
			const segments = [];
			for (let time = 0; time < totalDuration; time += windowSize) {
				const notesInWindow = this.beatmapData.notes.filter(
					n => n.time >= time && n.time < time + windowSize
				).length;
				segments.push({
					time,
					density: notesInWindow,
					y: (time / totalDuration) * 400
				});
			}
			return segments;
		}
		renderDensityScrollbar() {
			const scrollbar = this.panel.querySelector('#density-scrollbar');
			if (!scrollbar) return;
			scrollbar.innerHTML = '';
			const densitySegments = this.calculateDensity();
			const maxDensity = Math.max(...densitySegments.map(s => s.density), 1);
			densitySegments.forEach(segment => {
				const bar = document.createElement('div');
				bar.className = 'density-bar';
				const intensity = segment.density / maxDensity;
				if (intensity > 0.7) bar.classList.add('high');
				else if (intensity > 0.4) bar.classList.add('medium');
				bar.style.bottom = segment.y + 'px';
				bar.style.height = (400 / densitySegments.length) + 'px';
				bar.style.opacity = 0.3 + (intensity * 0.7);
				scrollbar.appendChild(bar);
			});
			this.densityIndicator = document.createElement('div');
			this.densityIndicator.className = 'density-indicator';
			scrollbar.appendChild(this.densityIndicator);
			this.updateDensityIndicator();
		}
		updateDensityIndicator() {
			if (!this.densityIndicator) return;
			const progress = (this.currentTime / this.getTotalDuration()) * 400;
			this.densityIndicator.style.bottom = progress + 'px';
		}
		setupEventListeners() {
			const closeBtn = this.panel.querySelector('.preview-close');
			if (closeBtn) {
				closeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.close();
				});
				closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
				closeBtn.addEventListener('mouseenter', () => {
					closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
					closeBtn.style.color = '#fff';
				});
				closeBtn.addEventListener('mouseleave', () => {
					closeBtn.style.background = 'none';
					closeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
				});
			}
			const playBtn = this.panel.querySelector('#play-pause-btn');
			playBtn?.addEventListener('click', (e) => {
				e.stopPropagation();
				this.isPlaying ? this.pause() : this.play();
			});
			const stopBtn = this.panel.querySelector('#stop-btn');
			stopBtn?.addEventListener('click', (e) => {
				e.stopPropagation();
				this.stop();
			});
			const scrollbar = this.panel.querySelector('#density-scrollbar');
			if (scrollbar) {
				let isDragging = false;
				const seekToY = (clientY) => {
					const rect = scrollbar.getBoundingClientRect();
					const y = clientY - rect.top;
					const progress = 1 - (y / rect.height);
					const time = progress * this.getTotalDuration();
					this.seek(Utils.clamp(time, 0, this.getTotalDuration()));
				};
				scrollbar.addEventListener('mousedown', (e) => {
					e.stopPropagation();
					isDragging = true;
					seekToY(e.clientY);
				});
				document.addEventListener('mousemove', (e) => {
					if (isDragging) seekToY(e.clientY);
				});
				document.addEventListener('mouseup', () => {
					isDragging = false;
				});
			}
			const scrollSpeedSlider = this.panel.querySelector('#scroll-speed-slider');
			const scrollSpeedDisplay = this.panel.querySelector('#scroll-speed-display');
			scrollSpeedSlider?.addEventListener('input', (e) => {
				e.stopPropagation();
				this.scrollSpeed = parseFloat(e.target.value);
				if (scrollSpeedDisplay) {
					scrollSpeedDisplay.textContent = `${this.scrollSpeed.toFixed(1)}x`;
				}
				this.draw();
			});
			const playbackRate = this.panel.querySelector('#playback-rate');
			playbackRate?.addEventListener('change', (e) => {
				e.stopPropagation();
				this.playbackRate = parseFloat(e.target.value);
				if (this.musicAudio) {
					this.musicAudio.playbackRate = this.playbackRate;
				}
			});
			this.canvas.addEventListener('wheel', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const scrollAmount = e.deltaY * 5;
				this.currentTime = Utils.clamp(
					this.currentTime + scrollAmount,
					0,
					this.getTotalDuration()
				);
				if (this.isPlaying) {
					this.startPlayTime = Date.now() - this.currentTime;
				}
				this.draw();
				const timeDisplay = this.panel.querySelector('#time-display');
				if (timeDisplay) {
					timeDisplay.textContent = `${this.formatTimeSimple(this.currentTime)} / ${this.formatTimeSimple(this.getTotalDuration())}`;
				}
			}, {
				passive: false
			});
			this.canvas.addEventListener('click', (e) => {
				if (e.shiftKey) return;
				e.stopPropagation();
				const rect = this.canvas.getBoundingClientRect();
				const y = e.clientY - rect.top;
				const progress = 1 - (y / rect.height);
				const time = progress * this.getTotalDuration();
				this.seek(Utils.clamp(time, 0, this.getTotalDuration()));
			});
			this.panel.querySelectorAll('button, input, select').forEach(control => {
				control.addEventListener('mousedown', (e) => e.stopPropagation());
			});
		}
		setupTimestampJumper() {
			const input = this.panel.querySelector('#timestamp-input');
			const jumpBtn = this.panel.querySelector('#jump-btn');
			if (!input || !jumpBtn) return;
			const parseTimestamp = (str) => {
				const parts = str.split(':');
				if (parts.length === 3) {
					const [mm, ss, ms] = parts.map(p => parseInt(p) || 0);
					return (mm * 60000) + (ss * 1000) + ms;
				} else if (parts.length === 2) {
					const [mm, ss] = parts.map(p => parseInt(p) || 0);
					return (mm * 60000) + (ss * 1000);
				}
				return parseInt(str) || 0;
			};
			const jump = () => {
				const time = parseTimestamp(input.value);
				if (time >= 0 && time <= this.getTotalDuration()) {
					this.seek(time);
					UI.showNotification(`Jumped to ${this.formatTimeSimple(time)}`, 'success');
					input.value = '';
				} else {
					UI.showNotification('Invalid timestamp', 'error');
				}
			};
			jumpBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				jump();
			});
			input.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Enter') jump();
			});
			input.addEventListener('mousedown', (e) => e.stopPropagation());
		}
		play() {
			if (this.isPlaying) return;
			this.isPlaying = true;
			this.startPlayTime = Date.now() - this.currentTime;
			const playBtn = this.panel.querySelector('#play-pause-btn');
			if (playBtn) playBtn.textContent = 'Pause';
			if (this.musicAudio) {
				this.musicAudio.currentTime = this.currentTime / 1000;
				this.musicAudio.playbackRate = this.playbackRate;
				this.musicAudio.play().catch(() => {});
			}
			this.updatePlayback();
		}
		pause() {
			if (!this.isPlaying) return;
			this.isPlaying = false;
			if (this.animationFrame) {
				cancelAnimationFrame(this.animationFrame);
				this.animationFrame = null;
			}
			if (this.musicAudio) {
				this.musicAudio.pause();
			}
			const playBtn = this.panel.querySelector('#play-pause-btn');
			if (playBtn) playBtn.textContent = 'Play';
		}
		stop() {
			this.pause();
			this.currentTime = 0;
			this.startPlayTime = 0;
			if (this.musicAudio) {
				this.musicAudio.currentTime = 0;
			}
			const timeDisplay = this.panel.querySelector('#time-display');
			if (timeDisplay) {
				timeDisplay.textContent = `0:00 / ${this.formatTimeSimple(this.getTotalDuration())}`;
			}
			this.draw();
		}
		seek(time) {
			this.currentTime = time;
			if (this.isPlaying) {
				this.startPlayTime = Date.now() - this.currentTime;
			}
			if (this.musicAudio) {
				this.musicAudio.currentTime = time / 1000;
			}
			this.draw();
		}
		updatePlayback() {
			if (!this.isPlaying) return;
			this.currentTime = (Date.now() - this.startPlayTime) * this.playbackRate;
			const totalDuration = this.getTotalDuration();
			if (this.currentTime >= totalDuration) {
				this.stop();
				return;
			}
			const timeDisplay = this.panel.querySelector('#time-display');
			if (timeDisplay) {
				timeDisplay.textContent = `${this.formatTimeSimple(this.currentTime)} / ${this.formatTimeSimple(totalDuration)}`;
			}
			this.draw();
			this.animationFrame = requestAnimationFrame(() => this.updatePlayback());
		}
		draw() {
			if (!this.ctx || !this.beatmapData) return;
			const {
				width,
				height
			} = this.canvas;
			const cols = this.beatmapData.cs;
			const colWidth = width / cols;
			const hitPosition = height * 0.8;
			this.ctx.fillStyle = '#000';
			this.ctx.fillRect(0, 0, width, height);
			this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
			this.ctx.lineWidth = 1;
			for (let i = 1; i < cols; i++) {
				this.ctx.beginPath();
				this.ctx.moveTo(i * colWidth, 0);
				this.ctx.lineTo(i * colWidth, height);
				this.ctx.stroke();
			}
			this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
			this.ctx.lineWidth = 2;
			this.ctx.beginPath();
			this.ctx.moveTo(0, hitPosition);
			this.ctx.lineTo(width, hitPosition);
			this.ctx.stroke();
			this.beatmapData.notes.forEach(note => {
				const timeDiff = note.time - this.currentTime;
				const y = hitPosition - (timeDiff * this.scrollSpeed);
				if (note.isLN) {
					const endY = hitPosition - ((note.endTime - this.currentTime) * this.scrollSpeed);
					if ((y < -200 && endY < -200) || (y > height + 200 && endY > height + 200)) return;
				} else {
					if (y < -50 || y > height + 50) return;
				}
				const x = note.col * colWidth;
				const noteWidth = colWidth - 4;
				const isHighlighted = this.highlightedNotes?.has(note.time);
				if (note.isLN) {
					const endY = hitPosition - ((note.endTime - this.currentTime) * this.scrollSpeed);
					const lnHeight = Math.max(y - endY, this.lnMinHeight);
					this.ctx.fillStyle = isHighlighted ? 'rgba(255, 204, 0, 0.9)' : 'rgba(255, 204, 0, 0.6)';
					this.ctx.fillRect(x + 2, endY, noteWidth, lnHeight);
					if (isHighlighted) {
						this.ctx.strokeStyle = 'rgba(255, 255, 100, 1)';
						this.ctx.lineWidth = 3;
						this.ctx.shadowColor = 'rgba(255, 255, 100, 0.8)';
						this.ctx.shadowBlur = 15;
					} else {
						this.ctx.strokeStyle = 'rgba(255, 204, 0, 0.8)';
						this.ctx.lineWidth = 2;
					}
					this.ctx.strokeRect(x + 2, endY, noteWidth, lnHeight);
					this.ctx.shadowBlur = 0;
					this.ctx.fillStyle = isHighlighted ? 'rgba(255, 255, 100, 1)' : 'rgba(255, 204, 0, 1)';
					this.ctx.fillRect(x + 2, y - this.noteHeight, noteWidth, this.noteHeight * 2);
					this.ctx.fillRect(x + 2, endY - this.noteHeight, noteWidth, this.noteHeight * 2);
				} else {
					if (isHighlighted) {
						this.ctx.fillStyle = 'rgba(100, 255, 255, 1)';
						this.ctx.shadowColor = 'rgba(100, 255, 255, 0.8)';
						this.ctx.shadowBlur = 15;
					} else {
						this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
					}
					this.ctx.fillRect(x + 2, y - this.noteHeight, noteWidth, this.noteHeight * 2);
					this.ctx.shadowBlur = 0;
					this.ctx.strokeStyle = isHighlighted ? 'rgba(100, 255, 255, 1)' : 'rgba(255, 255, 255, 1)';
					this.ctx.lineWidth = isHighlighted ? 3 : 1;
					this.ctx.strokeRect(x + 2, y - this.noteHeight, noteWidth, this.noteHeight * 2);
				}
			});
			this.beatmapData.notes.forEach(note => {
				if (note.isLN) {
					if (this.currentTime >= note.time && this.currentTime <= note.endTime) {
						const holdProgress = (this.currentTime - note.time) / (note.endTime - note.time);
						const alpha = 0.2 + (Math.sin(holdProgress * Math.PI * 4) * 0.1);
						this.ctx.fillStyle = `rgba(255, 204, 0, ${alpha})`;
						this.ctx.fillRect(note.col * colWidth, 0, colWidth, height);
					}
					const startDiff = Math.abs(note.time - this.currentTime);
					if (this.isPlaying && this.hitsoundEnabled && startDiff < 16 && Math.abs(note.time - this.lastHitTime) > 10) {
						this.playHitsound();
						this.lastHitTime = note.time;
					}
				} else {
					const timeDiff = Math.abs(note.time - this.currentTime);
					if (timeDiff < 50) {
						const alpha = 1 - (timeDiff / 50);
						this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
						this.ctx.fillRect(note.col * colWidth, 0, colWidth, height);
					}
					if (this.isPlaying && this.hitsoundEnabled && timeDiff < 16 && Math.abs(note.time - this.lastHitTime) > 10) {
						this.playHitsound();
						this.lastHitTime = note.time;
					}
				}
			});
			this.updateDensityIndicator();
		}
		playHitsound() {
			if (!this.hitsound) return;
			try {
				const sound = this.hitsound.cloneNode();
				sound.volume = this.hitsoundVolume;
				sound.play().catch(() => {});
			} catch (e) {
				this.hitsound.currentTime = 0;
				this.hitsound.play().catch(() => {});
			}
		}
		getTotalDuration() {
			if (!this.beatmapData || this.beatmapData.notes.length === 0) return 0;
			const lastNote = this.beatmapData.notes[this.beatmapData.notes.length - 1];
			return lastNote.isLN ? lastNote.endTime : lastNote.time;
		}
		formatTimeSimple(ms) {
			const minutes = Math.floor(ms / 60000);
			const seconds = Math.floor((ms % 60000) / 1000);
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
		close() {
			this.pause();
			if (this.musicAudio) {
				this.musicAudio.pause();
				this.musicAudio.src = '';
				this.musicAudio = null;
			}
			if (this.panel) {
				this.panel.remove();
				this.panel = null;
			}
		}
		setupNoteSelection() {
			let selectionStart = null;
			let selectionEnd = null;
			let isSelecting = false;
			let selectedNotes = new Set();
			const getTimeFromY = (clientY) => {
				const rect = this.canvas.getBoundingClientRect();
				const y = clientY - rect.top;
				const height = this.canvas.height;
				const hitPosition = height * 0.8;
				const pixelsFromHit = hitPosition - y;
				return this.currentTime + (pixelsFromHit / this.scrollSpeed);
			};
			this.canvas.addEventListener('mousedown', (e) => {
				if (e.shiftKey) {
					e.preventDefault();
					isSelecting = true;
					selectionStart = getTimeFromY(e.clientY);
					selectionEnd = selectionStart;
					selectedNotes.clear();
				}
			});
			this.canvas.addEventListener('mousemove', (e) => {
				if (isSelecting && e.shiftKey) {
					selectionEnd = getTimeFromY(e.clientY);
					const minTime = Math.min(selectionStart, selectionEnd);
					const maxTime = Math.max(selectionStart, selectionEnd);
					selectedNotes.clear();
					this.beatmapData.notes.forEach(note => {
						if (note.time >= minTime && note.time <= maxTime) {
							selectedNotes.add(note);
						}
					});
					this.drawSelection(minTime, maxTime, selectedNotes);
				}
			});
			document.addEventListener('mouseup', (e) => {
				if (isSelecting) {
					isSelecting = false;
					if (selectedNotes.size > 0) {
						this.copySelectedNotes(selectedNotes);
					}
					selectionStart = null;
					selectionEnd = null;
					selectedNotes.clear();
					this.draw();
				}
			});
		}
		drawSelection(minTime, maxTime, selectedNotes) {
			this.draw();
			const {
				width,
				height
			} = this.canvas;
			const hitPosition = height * 0.8;
			const startY = hitPosition - ((minTime - this.currentTime) * this.scrollSpeed);
			const endY = hitPosition - ((maxTime - this.currentTime) * this.scrollSpeed);
			const selectionHeight = Math.abs(startY - endY);
			const selectionY = Math.min(startY, endY);
			this.ctx.fillStyle = 'rgba(100, 200, 255, 0.2)';
			this.ctx.fillRect(0, selectionY, width, selectionHeight);
			this.ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
			this.ctx.lineWidth = 2;
			this.ctx.strokeRect(0, selectionY, width, selectionHeight);
			this.ctx.fillStyle = 'rgba(100, 200, 255, 0.9)';
			this.ctx.font = '12px sans-serif';
			this.ctx.textAlign = 'center';
			this.ctx.fillText(`${selectedNotes.size} notes selected`, width / 2, selectionY - 10);
		}
		copySelectedNotes(selectedNotes) {
			if (selectedNotes.size === 0) return;
			const notesArray = Array.from(selectedNotes).sort((a, b) => a.time - b.time);
			const timestamp = RCCheckerManager.formatTime(notesArray[0].time);
			const noteSelection = notesArray
				.map(n => `${Math.round(n.time)}|${n.col}`)
				.join(',');
			const editorLink = `${timestamp} (${noteSelection}) -`;
			navigator.clipboard.writeText(editorLink)
				.then(() => {
					UI.showNotification(`Copied ${selectedNotes.size} notes!`, 'success');
				})
				.catch(() => {
					const textarea = document.createElement('textarea');
					textarea.value = editorLink;
					textarea.style.position = 'fixed';
					textarea.style.opacity = '0';
					document.body.appendChild(textarea);
					textarea.select();
					document.execCommand('copy');
					document.body.removeChild(textarea);
					UI.showNotification(`Copied ${selectedNotes.size} notes!`, 'success');
				});
		}
	}
	// COLLAB NOTES SYSTEM
	class CollabNotesManager {
		static SERVER_IP = localStorage.getItem('collab_server_ip') || '';
		static SERVER_PORT = localStorage.getItem('collab_server_port') || '3000';
		static notes = [];
		static isConnected = false;
		static pollInterval = null;
		static lastPollTime = 0;
		static usersInterval = null;
		static usersUpdateInterval = null;
		static currentUserId = null;
		static currentAvatarUrl = null;
		static lastRenderedUsers = new Set();
		static init() {
			if (!this.SERVER_IP) {
				debug.log('Collab mode disabled - no server IP set');
				return;
			}
			this.ensureUsernameSet();
			this.detectAvatar();
			this.startPolling();
			this.loadNotes();
			this.startUserPresence();
		}
		static ensureUsernameSet() {
			let username = localStorage.getItem('collab_username');
			if (!username) {
				username = prompt('Enter your osu! username (required for Collab Notes):');
				if (username && username.trim() !== '') {
					localStorage.setItem('collab_username', username.trim());
				} else {
					alert('Username is required to use Collab Notes.');
					throw new Error('Username not set');
				}
			}
			this.currentUserId = username.trim();
		}
		static detectAvatar() {
			if (!location.pathname.includes('/discussion')) return;
			const avatarEl = document.querySelector('.js-current-user-avatar');
			if (avatarEl) {
				const style = avatarEl.getAttribute('style');
				if (style) {
					const urlMatch = style.match(/url\(['"]?([^'"]+)['"]?\)/);
					if (urlMatch) {
						this.currentAvatarUrl = urlMatch[1];
						console.log('Detected avatar URL:', this.currentAvatarUrl);
					}
				}
			}
		}
		static startPolling() {
			if (this.pollInterval) {
				clearInterval(this.pollInterval);
			}
			console.log('Starting polling for new notes and chat...');
			this.isConnected = true;
			this.pollInterval = setInterval(() => {
				this.checkForNewNotes();
				this.loadChatMessages();
			}, 3000);
			this.checkForNewNotes();
			this.loadChatMessages();
		}
		static stopPolling() {
			if (this.pollInterval) {
				clearInterval(this.pollInterval);
				this.pollInterval = null;
			}
			if (this.usersInterval) {
				clearInterval(this.usersInterval);
				this.usersInterval = null;
			}
			if (this.usersUpdateInterval) {
				clearInterval(this.usersUpdateInterval);
				this.usersUpdateInterval = null;
			}
			this.isConnected = false;
			console.log('Stopped polling');
		}
		static startUserPresence() {
			if (!location.pathname.includes('/discussion')) return;
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) return;
			if (this.usersInterval) clearInterval(this.usersInterval);
			if (this.usersUpdateInterval) clearInterval(this.usersUpdateInterval);
			this.sendPresence(beatmapsetId);
			this.usersInterval = setInterval(() => {
				const currentBeatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
				if (currentBeatmapsetId) {
					this.sendPresence(currentBeatmapsetId);
				}
			}, 8000);
			this.usersUpdateInterval = setInterval(() => {
				const currentBeatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
				if (currentBeatmapsetId) {
					this.fetchActiveUsers(currentBeatmapsetId);
				}
			}, 6000);
			setTimeout(() => this.fetchActiveUsers(beatmapsetId), 1000);
		}
		static sendPresence(users, beatmapsetId) {
			if (!this.SERVER_IP || !this.currentUserId) return;
			const username = localStorage.getItem('collab_username') || this.currentUserId;
			GM_xmlhttpRequest({
				method: 'POST',
				url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/collab/users`,
				headers: {
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					userId: this.currentUserId,
					username: username,
					avatarUrl: this.currentAvatarUrl,
					beatmapsetId,
					timestamp: Date.now()
				}),
				onload: () => {},
				onerror: (err) => {
					console.warn('Presence send failed:', err);
				},
				timeout: 3000
			});
		}
		static fetchActiveUsers(beatmapsetId) {
			if (!this.SERVER_IP) return;
			GM_xmlhttpRequest({
				method: 'GET',
				url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/collab/users`,
				onload: (response) => {
					if (response.status >= 200 && response.status < 300) {
						try {
							const users = JSON.parse(response.responseText);
							console.log('Raw users from server:', users);
							const uniqueUsers = this.deduplicateUsers(users);
							console.log('Deduplicated users:', uniqueUsers);
							this.renderActiveUsers(uniqueUsers, beatmapsetId);
						} catch (e) {
							console.error('Failed to parse users:', e);
						}
					} else {
						console.warn('Failed to fetch users:', response.status);
					}
				},
				onerror: (err) => {
					console.error('User fetch error:', err);
				},
				timeout: 5000
			});
		}
		static deduplicateUsers(users) {
			const userMap = new Map();
			users.forEach(user => {
				const existing = userMap.get(user.userId);
				if (!existing || user.timestamp > existing.timestamp) {
					userMap.set(user.userId, user);
				}
			});
			return Array.from(userMap.values());
		}
		static renderActiveUsers(users, beatmapsetId) {
			const container = document.getElementById('active-users-list');
			const countEl = document.getElementById('active-user-count');
			console.log('renderActiveUsers called:', {
				usersCount: users.length,
				hasContainer: !!container,
				hasCountEl: !!countEl,
				beatmapsetId: beatmapsetId
			});
			if (!container || !countEl) {
				console.error('Missing DOM elements for active users');
				return;
			}
			const now = Date.now();
			const activeUsers = users.filter(user =>
				user.userId !== this.currentUserId &&
				(now - user.timestamp) < 30000
			);
			countEl.textContent = activeUsers.length;
			if (activeUsers.length === 0) {
				container.innerHTML = `
                <div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.3); font-size: 10px; font-style: italic;">
                    No other users online
                </div>
            `;
				return;
			}
			activeUsers.sort((a, b) => b.timestamp - a.timestamp);
			container.innerHTML = activeUsers.map(user => {
				const isViewingSame = user.beatmapsetId === beatmapsetId;
				const lastSeen = Math.floor((now - user.timestamp) / 1000);
				const mapUrl = `/beatmapsets/${user.beatmapsetId}/discussion`;
				return `
                <div class="active-user-card" data-url="${mapUrl}" data-userid="${user.userId}" style="display: flex; align-items: center; gap: 8px; padding: 6px; background: rgba(${isViewingSame ? '76, 175, 80' : '26, 26, 26'}, 0.${isViewingSame ? '2' : '6'}); border-radius: 4px; margin-bottom: 4px; ${isViewingSame ? 'border: 1px solid rgba(76, 175, 80, 0.4);' : ''} cursor: pointer; transition: all 0.15s ease;">
                    <div style="width: 24px; height: 24px; border-radius: 50%; background-image: url('${user.avatarUrl}'); background-size: cover; flex-shrink: 0;"></div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 11px; color: rgba(255,255,255,0.9); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${Utils.sanitizeHTML(user.username)}
                            ${isViewingSame ? '<i class="fas fa-eye" style="font-size: 9px; color: #4caf50; margin-left: 4px;"></i>' : '<i class="fas fa-external-link-alt" style="font-size: 8px; color: rgba(255,255,255,0.4); margin-left: 4px;"></i>'}
                        </div>
                        <div style="font-size: 9px; color: rgba(255,255,255,0.5);">
                            ${isViewingSame ? 'Viewing this map' : `<span style="text-decoration: underline;">Map #${user.beatmapsetId}</span>`} • ${lastSeen}s ago
                        </div>
                    </div>
                </div>
            `;
			}).join('');
			container.querySelectorAll('.active-user-card').forEach(card => {
				card.addEventListener('mouseenter', () => {
					card.style.background = 'rgba(255, 255, 255, 0.08)';
				});
				card.addEventListener('mouseleave', () => {
					const isViewingSame = card.querySelector('.fa-eye') !== null;
					card.style.background = `rgba(${isViewingSame ? '76, 175, 80' : '26, 26, 26'}, 0.${isViewingSame ? '2' : '6'})`;
				});
				card.addEventListener('click', () => {
					const url = card.dataset.url;
					window.location.href = url;
				});
			});
		}
		static async checkForNewNotes() {
			if (!this.SERVER_IP) return;
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) return;
			GM_xmlhttpRequest({
				method: 'GET',
				url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/notes?beatmapsetId=${beatmapsetId}`,
				onload: (response) => {
					if (response.status >= 200 && response.status < 300) {
						try {
							const result = JSON.parse(response.responseText);
							const serverNotes = result.data || result;
							serverNotes.forEach(serverNote => {
								const exists = this.notes.find(n =>
									n.created === serverNote.created &&
									n.author === serverNote.author
								);
								if (!exists) {
									console.log('New note received:', serverNote);
									this.notes.push(serverNote);
									this.addNoteToUI(serverNote);
									const currentUser = localStorage.getItem('collab_username') || 'Anonymous';
									if (serverNote.author !== currentUser) {
										UI.showNotification(`New note from ${serverNote.author}`, 'info');
									}
								}
							});
							this.lastPollTime = Date.now();
						} catch (error) {
							console.error('Failed to parse notes:', error);
						}
					}
				},
				onerror: () => {
					console.warn('Poll failed - server may be down');
				},
				timeout: 5000
			});
		}
		static renderChatMessages(messages) {
			const container = document.getElementById('collab-chat-messages');
			if (!container) return;
			container.innerHTML = messages.map(msg => `
		<div style="padding: 4px 6px; margin-bottom: 4px; background: rgba(0,0,0,0.2); border-radius: 3px;">
			<div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 2px;">
				<strong>${Utils.sanitizeHTML(msg.author)}</strong>
				<span style="opacity: 0.5; margin-left: 4px;">${new Date(msg.timestamp).toLocaleTimeString()}</span>
			</div>
			<div style="font-size: 11px; color: rgba(255,255,255,0.9);">${Utils.sanitizeHTML(msg.text)}</div>
		</div>
	`).join('');
			container.scrollTop = container.scrollHeight;
		}
		static addNoteToUI(note) {
			const container = document.getElementById('collab-notes-container');
			if (!container) return;
			const noteDiv = document.createElement('div');
			noteDiv.dataset.noteid = note.id || note.created;
			noteDiv.style.cssText = 'background: rgba(26, 26, 26, 0.6); border-radius: 4px; padding: 10px; margin-bottom: 8px;';
			noteDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-family: monospace; font-size: 11px; color: #6bb6ff;">${Utils.sanitizeHTML(note.time)}</span>
            <span style="font-size: 10px; color: rgba(255, 255, 255, 0.5);">${Utils.sanitizeHTML(note.author)}</span>
        </div>
        <div style="color: rgba(255,255,255,0.85); font-size: 11px; margin-bottom: 4px;">${Utils.sanitizeHTML(note.text)}</div>
        <div style="font-size: 9px; color: rgba(255,255,255,0.4);">${new Date(note.created).toLocaleString()}</div>
        ${this.renderReactions(note.reactions || [], note.id || note.created)}
        ${this.renderReplies(note.replies || [])}
        <div style="display: flex; gap: 6px; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
            <button class="react-btn" data-noteid="${note.id || note.created}" style="background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 10px; padding: 2px 6px; border-radius: 3px; transition: all 0.15s;">
                <i class="fas fa-smile"></i> React
            </button>
            <button class="reply-btn" data-noteid="${note.id || note.created}" style="background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 10px; padding: 2px 6px; border-radius: 3px; transition: all 0.15s;">
                <i class="fas fa-reply"></i> Reply
            </button>
        </div>
    `;
			const reactBtn = noteDiv.querySelector('.react-btn');
			const replyBtn = noteDiv.querySelector('.reply-btn');
			reactBtn?.addEventListener('click', async (e) => {
				e.stopPropagation();
				await this.showEmojiPicker(e.target, note.id || note.created);
			});
			replyBtn?.addEventListener('click', async (e) => {
				e.stopPropagation();
				const text = prompt('Reply:');
				if (text?.trim()) await this.addReply(note.id || note.created, text);
			});
			container.appendChild(noteDiv);
			this.setupReactionHandlers(noteDiv);
			container.scrollTop = container.scrollHeight;
		}
		static async loadNotes() {
			if (!this.SERVER_IP) return;
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) {
				debug.log('No beatmapset ID for loading notes');
				return Promise.resolve([]);
			}
			return new Promise((resolve) => {
				const url = `http://${this.SERVER_IP}:${this.SERVER_PORT}/notes?beatmapsetId=${beatmapsetId}`;
				console.log('Loading notes from:', url);
				GM_xmlhttpRequest({
					method: 'GET',
					url: url,
					onload: (response) => {
						if (response.status >= 200 && response.status < 300) {
							try {
								const result = JSON.parse(response.responseText);
								this.notes = result.data || result;
								console.log('Loaded notes:', this.notes);
								const container = document.getElementById('collab-notes-container');
								if (container) {
									container.innerHTML = '';
									if (this.notes.length > 0) {
										this.notes.forEach(n => this.addNoteToUI(n));
									} else {
										container.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.3);">No notes yet</div>';
									}
								}
								resolve(this.notes);
							} catch (error) {
								console.error('Failed to parse notes:', error);
								resolve([]);
							}
						} else {
							console.error('Failed to load notes:', response.status);
							resolve([]);
						}
					},
					onerror: (error) => {
						console.error('Failed to load notes:', error);
						resolve([]);
					},
					timeout: 10000
				});
			});
		}
		static async addNote(note) {
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) {
				UI.showNotification('No beatmapset detected', 'error');
				return Promise.reject('No beatmapset ID');
			}
			note.beatmapsetId = beatmapsetId;
			return new Promise((resolve, reject) => {
				const url = `http://${this.SERVER_IP}:${this.SERVER_PORT}/notes`;
				console.log('POST to:', url);
				console.log('Note data:', note);
				GM_xmlhttpRequest({
					method: 'POST',
					url: url,
					headers: {
						'Content-Type': 'application/json'
					},
					data: JSON.stringify(note),
					onload: (response) => {
						console.log('Response status:', response.status);
						console.log('Response body:', response.responseText);
						if (response.status >= 200 && response.status < 300) {
							UI.showNotification('Note added!', 'success');
							this.notes.push(note);
							this.addNoteToUI(note);
							resolve(response);
						} else {
							const error = `Server returned ${response.status}: ${response.responseText}`;
							console.error(error);
							UI.showNotification(`Failed: ${response.status}`, 'error');
							reject(new Error(error));
						}
					},
					onerror: (error) => {
						console.error('Request failed:', error);
						UI.showNotification('Connection failed - check server', 'error');
						reject(error);
					},
					ontimeout: () => {
						console.error('Request timed out');
						UI.showNotification('Request timed out', 'error');
						reject(new Error('Timeout'));
					},
					timeout: 10000
				});
			});
		}
		static showAddNoteDialog() {
			if (!this.SERVER_IP) {
				UI.showNotification('Collab mode not connected', 'warning');
				return;
			}
			const timestamp = prompt('Timestamp (e.g., 01:23:456):');
			if (!timestamp) return;
			const text = prompt('Note text:');
			if (!text) return;
			const note = {
				time: timestamp,
				author: this.currentUserId,
				text: text.trim(),
				resolved: false,
				created: Date.now()
			};
			this.addNote(note);
		}
		// CHAT SYSTEM
		static async sendChatMessage(text) {
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId || !this.SERVER_IP) {
				UI.showNotification('Not connected to collab server', 'warning');
				return;
			}
			const username = localStorage.getItem('collab_username') || this.currentUserId || 'Anonymous';
			const message = {
				author: username,
				text: text.trim(),
				beatmapsetId,
				timestamp: Date.now()
			};
			try {
				await new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: 'POST',
						url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/chat`,
						headers: {
							'Content-Type': 'application/json'
						},
						data: JSON.stringify(message),
						onload: (response) => {
							if (response.status >= 200 && response.status < 300) {
								resolve();
							} else {
								reject(new Error(`Server returned ${response.status}`));
							}
						},
						onerror: reject,
						timeout: 5000
					});
				});
				this.loadChatMessages();
			} catch (error) {
				console.error('Failed to send chat message:', error);
				UI.showNotification('Failed to send message', 'error');
			}
		}
		static async loadChatMessages() {
			if (!this.SERVER_IP) return;
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) return;
			try {
				const messages = await new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: 'GET',
						url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/chat?beatmapsetId=${beatmapsetId}`,
						onload: (response) => {
							if (response.status >= 200 && response.status < 300) {
								try {
									resolve(JSON.parse(response.responseText));
								} catch (e) {
									resolve([]);
								}
							} else {
								resolve([]);
							}
						},
						onerror: () => resolve([]),
						timeout: 5000
					});
				});
				this.renderChatMessages(messages);
			} catch (error) {
				console.error('Failed to load chat messages:', error);
			}
		}
		static renderChatMessages(messages) {
			const container = document.getElementById('collab-chat-messages');
			if (!container) return;
			if (!messages || messages.length === 0) {
				container.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.3); font-size: 10px; font-style: italic;">No messages yet</div>';
				return;
			}
			container.innerHTML = messages.map(msg => `
		<div style="padding: 4px 6px; margin-bottom: 4px; background: rgba(0,0,0,0.2); border-radius: 3px;">
			<div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 2px;">
				<strong>${Utils.sanitizeHTML(msg.author)}</strong>
				<span style="opacity: 0.5; margin-left: 4px;">${new Date(msg.timestamp).toLocaleTimeString()}</span>
			</div>
			<div style="font-size: 11px; color: rgba(255,255,255,0.9);">${Utils.sanitizeHTML(msg.text)}</div>
		</div>
	`).join('');
			container.scrollTop = container.scrollHeight;
		}
		// REACTIONS SYSTEM
		static async addReaction(noteId, emoji) {
			if (!this.SERVER_IP) return;
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) return;
			try {
				await new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: 'POST',
						url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/notes/react`,
						headers: {
							'Content-Type': 'application/json'
						},
						data: JSON.stringify({
							noteId,
							emoji,
							username: this.currentUserId,
							beatmapsetId
						}),
						onload: (response) => {
							if (response.status >= 200 && response.status < 300) {
								UI.showNotification('Reaction added!', 'success');
								this.loadNotes();
								resolve();
							} else {
								reject(new Error(`Server returned ${response.status}`));
							}
						},
						onerror: reject,
						timeout: 5000
					});
				});
			} catch (error) {
				console.error('Failed to add reaction:', error);
				UI.showNotification('Failed to add reaction', 'error');
			}
		}
		static renderReactions(reactions, noteId) {
			if (!reactions || reactions.length === 0) return '';
			const grouped = {};
			reactions.forEach(r => {
				if (!grouped[r.emoji]) grouped[r.emoji] = [];
				grouped[r.emoji].push(r.username);
			});
			return `
		<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px;">
			${Object.entries(grouped).map(([emoji, users]) => `
				<span style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 10px; font-size: 11px; cursor: pointer;" title="${users.join(', ')}">
					${emoji} ${users.length}
				</span>
			`).join('')}
		</div>
	`;
		}
		static async showEmojiPicker(button, noteId) {
			const emojis = ['👍', '❤️', '😂', '🔥', '✅', '👀', '🎵', '⭐'];
			const picker = document.createElement('div');
			picker.style.cssText = `
        position: fixed;
        background: rgba(12, 12, 12, 0.98);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 8px;
        display: flex;
        gap: 6px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.8);
    `;
			const rect = button.getBoundingClientRect();
			picker.style.left = rect.left + 'px';
			picker.style.top = (rect.bottom + 5) + 'px';
			emojis.forEach(emoji => {
				const btn = document.createElement('button');
				btn.textContent = emoji;
				btn.style.cssText = `
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            transition: all 0.15s;
        `;
				btn.addEventListener('mouseenter', () => {
					btn.style.background = 'rgba(255, 255, 255, 0.1)';
					btn.style.transform = 'scale(1.2)';
				});
				btn.addEventListener('mouseleave', () => {
					btn.style.background = 'none';
					btn.style.transform = 'scale(1)';
				});
				btn.addEventListener('click', async (e) => {
					e.stopPropagation();
					await this.addReaction(noteId, emoji);
					picker.remove();
				});
				picker.appendChild(btn);
			});
			document.body.appendChild(picker);
			setTimeout(() => {
				const removeHandler = (e) => {
					if (!picker.contains(e.target) && e.target !== button) {
						picker.remove();
						document.removeEventListener('click', removeHandler);
					}
				};
				document.addEventListener('click', removeHandler);
			}, 100);
		}
		// REPLIES SYSTEM
		static async addReply(noteId, text) {
			if (!this.SERVER_IP) return;
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) return;
			try {
				await new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: 'POST',
						url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/notes/reply`,
						headers: {
							'Content-Type': 'application/json'
						},
						data: JSON.stringify({
							noteId,
							text,
							username: this.currentUserId,
							beatmapsetId,
							timestamp: Date.now()
						}),
						onload: (response) => {
							if (response.status >= 200 && response.status < 300) {
								UI.showNotification('Reply added!', 'success');
								this.loadNotes();
								resolve();
							} else {
								reject(new Error(`Server returned ${response.status}`));
							}
						},
						onerror: reject,
						timeout: 5000
					});
				});
			} catch (error) {
				console.error('Failed to add reply:', error);
				UI.showNotification('Failed to add reply', 'error');
			}
		}
		static renderReplies(replies) {
			if (!replies || replies.length === 0) return '';
			return `
		<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05);">
			${replies.map(r => `
				<div style="background: rgba(0,0,0,0.2); padding: 6px 8px; border-radius: 3px; margin-bottom: 4px;">
					<div style="font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 2px;">
						<strong>${Utils.sanitizeHTML(r.username)}</strong>
						<span style="opacity: 0.5; margin-left: 4px;">${new Date(r.timestamp).toLocaleTimeString()}</span>
					</div>
					<div style="font-size: 10px; color: rgba(255,255,255,0.85);">${Utils.sanitizeHTML(r.text)}</div>
				</div>
			`).join('')}
		</div>
	`;
		}
		// SESSION HISTORY
		static async fetchSessionHistory() {
			if (!this.SERVER_IP) return [];
			const beatmapsetId = window.location.pathname.match(/\/beatmapsets\/(\d+)/)?.[1];
			if (!beatmapsetId) return [];
			try {
				return await new Promise((resolve, reject) => {
					GM_xmlhttpRequest({
						method: 'GET',
						url: `http://${this.SERVER_IP}:${this.SERVER_PORT}/session/history?beatmapsetId=${beatmapsetId}`,
						onload: (response) => {
							if (response.status >= 200 && response.status < 300) {
								try {
									resolve(JSON.parse(response.responseText));
								} catch (e) {
									resolve([]);
								}
							} else {
								resolve([]);
							}
						},
						onerror: () => resolve([]),
						timeout: 5000
					});
				});
			} catch (error) {
				console.error('Failed to fetch history:', error);
				return [];
			}
		}
		static renderSessionHistory(history) {
			if (!history || history.length === 0) {
				return '<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.3);">No session history available</div>';
			}
			return history.map(event => {
				const time = new Date(event.timestamp).toLocaleString();
				let icon = 'fas fa-info-circle';
				let color = '#6bb6ff';
				if (event.type === 'note') {
					icon = 'fas fa-sticky-note';
					color = '#4caf50';
				} else if (event.type === 'reaction') {
					icon = 'fas fa-smile';
					color = '#ffd93d';
				} else if (event.type === 'reply') {
					icon = 'fas fa-reply';
					color = '#6bb6ff';
				} else if (event.type === 'chat') {
					icon = 'fas fa-comment';
					color = '#9c27b0';
				}
				return `
			<div style="background: rgba(26,26,26,0.6); border-radius: 4px; padding: 10px; margin-bottom: 8px;">
				<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
					<span style="color: ${color}; font-size: 11px;">
						<i class="${icon}"></i> ${event.type.toUpperCase()}
					</span>
					<span style="font-size: 10px; color: rgba(255,255,255,0.5);">${time}</span>
				</div>
				<div style="font-size: 11px; color: rgba(255,255,255,0.85);">
					<strong>${Utils.sanitizeHTML(event.author)}</strong>: ${Utils.sanitizeHTML(event.preview || event.text || '')}
				</div>
			</div>
		`;
			}).join('');
		}
	}
	// TB INITIALIZATION
	class OsuTB {
		constructor() {
			this.state = new TBState();
			this.keyboardManager = new KeyboardManager(this.state);
			this.TB = null;
			this.livePreview = null;
			this.cleanupFunctions = [];
			this.observedTextareas = new WeakSet();
			this.lastTextareaValue = '';
			this.previewUpdateInterval = null;
			this.currentPath = location.pathname;
		}
		async init() {
			try {
				debug.log('Initializing TB v6.2...');
				this.state.load();
				await this.waitForPage();
				StyleManager.injectStyles();
				this.createTB();
				this.initializeFeatures();
				this.setupNavigationWatcher();
				debug.log('TB fully initialized');
			} catch (error) {
				debug.error('Failed to initialize:', error);
				UI.showNotification('Failed to load TB', 'error');
			}
		}
		async waitForPage() {
			if (document.readyState !== 'complete') {
				await new Promise(resolve => {
					window.addEventListener('load', resolve, {
						once: true
					});
				});
			}
			await new Promise(resolve => setTimeout(resolve, 1000));
			return true;
		}
		createTB() {
			this.TB = UI.createTB(this.state);
			document.body.appendChild(this.TB);
			this.setupEventListeners();
			this.setupNoteSelection();
			setTimeout(() => {
				UI.updateButtonLayout(this.TB);
			}, 100);
		}
		setupEventListeners() {
			this.TB.addEventListener('click', (e) => {
				const btn = e.target.closest('.osu-btn');
				if (btn) {
					const textarea = TextEditor.findActiveTextarea();
					if (textarea) {
						textarea.focus();
					}
					TBActions.executeAction(btn.dataset.tool);
				}
			});
			const dragCleanup = UI.makeDraggable(this.TB, this.TB, (position) => {
				this.state.position = position;
				this.state.save();
			});
			this.cleanupFunctions.push(dragCleanup);
			const resizeCleanup = UI.makeResizable(this.TB, (size) => {
				this.state.size = size;
				this.state.save();
			});
			this.cleanupFunctions.push(resizeCleanup);
			const resizeHandler = Utils.debounce(() => {
				UI.updateButtonLayout(this.TB);
			}, 200);
			window.addEventListener('resize', resizeHandler);
			this.cleanupFunctions.push(() => window.removeEventListener('resize', resizeHandler));
		}
		setupNoteSelection() {}
		setupNavigationWatcher() {
			const titleElement = document.querySelector('title');
			if (titleElement) {
				const observer = new MutationObserver(() => {
					if (location.pathname !== this.currentPath) {
						this.currentPath = location.pathname;
						this.handleNavigation();
					}
				});
				observer.observe(titleElement, {
					childList: true
				});
				this.cleanupFunctions.push(() => observer.disconnect());
			}
			const popstateHandler = () => this.handleNavigation();
			window.addEventListener('popstate', popstateHandler);
			this.cleanupFunctions.push(() => window.removeEventListener('popstate', popstateHandler));
			const hashChangeHandler = () => {
				debug.log('Hash changed:', location.hash);
				this.handleDifficultySwitch();
			};
			window.addEventListener('hashchange', hashChangeHandler);
			this.cleanupFunctions.push(() => window.removeEventListener('hashchange', hashChangeHandler));
			debug.log('Navigation watcher initialized');
		}
		handleDifficultySwitch() {
			if (!location.pathname.includes('/discussion')) return;
			debug.log('Difficulty switch detected');
			const existingPreview = document.getElementById('beatmap-preview-player');
			if (existingPreview) {
				existingPreview.remove();
				setTimeout(() => {
					const previewPlayer = new BeatmapPreviewPlayer(true);
					debug.log('Beatmap preview player reloaded');
				}, 500);
			}
			const existingRC = document.getElementById('rc-checker-panel');
			if (existingRC) {
				existingRC.remove();
				setTimeout(() => {
					RCCheckerManager.openRCChecker(true);
				}, 800);
			}
			if (window.beatmapPreviewInstance) {
				const notePreviewHandler = window.beatmapPreviewInstance;
				if (notePreviewHandler && notePreviewHandler.beatmapCache) {
					notePreviewHandler.beatmapCache.clear();
				}
			}
		}
		handleNavigation() {
			if (location.pathname.includes('/discussion')) {
				if (!document.body.contains(this.TB)) {
					document.body.appendChild(this.TB);
				}
				if (this.livePreview) {
					if (!document.body.contains(this.livePreview)) {
						document.body.appendChild(this.livePreview);
						this.setupPreviewUpdates();
					}
				} else {
					this.createLivePreview();
				}
				this.observedTextareas = new WeakSet();
				this.lastTextareaValue = '';
				setTimeout(() => {
					const textarea = TextEditor.findActiveTextarea();
					if (textarea) {
						this.observedTextareas.add(textarea);
						this.updatePreviewContent(textarea.value || '');
					}
				}, 800);
			} else {
				if (this.livePreview && document.body.contains(this.livePreview)) {
					this.livePreview.style.display = 'none';
				}
				if (this.previewUpdateInterval) {
					clearInterval(this.previewUpdateInterval);
					this.previewUpdateInterval = null;
				}
			}
		}
		initializeFeatures() {
			if (this.state.keyboardShortcuts) {
				this.keyboardManager.init();
			}
			if (location.pathname.includes('/discussion')) {
				setTimeout(() => {
					this.createLivePreview();
					this.setupTextareaWatcher();
				}, 500);
				setTimeout(() => {
					NotesManager.showNotesPanel();
				}, 800);
			} else if (this.livePreview) {
				this.livePreview.style.display = 'none';
			}
		}
		createLivePreview() {
			if (!location.pathname.includes('/discussion')) {
				return;
			}
			const existing = document.getElementById('osu-live-preview');
			if (existing) {
				existing.style.display = 'block';
				return;
			}
			this.livePreview = Utils.createElement('div');
			this.livePreview.id = 'osu-live-preview';
			this.livePreview.className = 'osu-live-preview';
			this.livePreview.innerHTML = `
                                <div style="text-align: center; padding: 20px 14px 16px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); cursor: move; user-select: none;">
                                        <div style="font-size: 14px; color: #eee; font-weight: 600;">
                                                <i class="fas fa-eye"></i> Live Preview
                                        </div>
                                </div>
                                <div class="preview-content"></div>
                        `;
			const position = this.state.previewPosition ||
				Utils.getOptimalPosition(this.livePreview, TextEditor.findActiveTextarea());
			this.livePreview.style.left = position.x + 'px';
			this.livePreview.style.top = position.y + 'px';
			this.livePreview.style.display = 'block';
			document.body.appendChild(this.livePreview);
			const header = this.livePreview.querySelector('[style*="cursor: move"]');
			const dragCleanup = UI.makeDraggable(this.livePreview, header, (position) => {
				this.state.previewPosition = position;
				this.state.save();
			});
			this.cleanupFunctions.push(dragCleanup);
			this.setupPreviewUpdates();
		}
		setupPreviewUpdates() {
			if (!location.pathname.includes('/discussion')) {
				return;
			}
			const updatePreview = () => {
				if (!document.body.contains(this.livePreview)) {
					document.body.appendChild(this.livePreview);
				}
				const textarea = TextEditor.findActiveTextarea();
				if (textarea && textarea.value !== this.lastTextareaValue) {
					this.lastTextareaValue = textarea.value;
					this.updatePreviewContent(textarea.value);
				}
			};
			const inputHandler = (e) => {
				if (e.target?.tagName === 'TEXTAREA') {
					Utils.debounce(updatePreview, 150)();
				}
			};
			document.addEventListener('input', inputHandler, true);
			this.cleanupFunctions.push(() => {
				document.removeEventListener('input', inputHandler, true);
			});
			this.previewUpdateInterval = setInterval(updatePreview, 500);
			this.cleanupFunctions.push(() => {
				if (this.previewUpdateInterval) {
					clearInterval(this.previewUpdateInterval);
				}
			});
			setTimeout(updatePreview, 500);
		}
		setupTextareaWatcher() {
			const observer = new MutationObserver(Utils.debounce(() => {
				const textarea = TextEditor.findActiveTextarea();
				if (textarea && !this.observedTextareas.has(textarea)) {
					this.observedTextareas.add(textarea);
					debug.log('New textarea observed');
				}
			}, 400));
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			this.cleanupFunctions.push(() => observer.disconnect());
		}
		updatePreviewContent(text) {
			if (!this.livePreview || this.livePreview.style.display === 'none') return;
			const content = this.livePreview.querySelector('.preview-content');
			if (!content) return;
			if (!text.trim()) {
				content.innerHTML = '<div style="text-align: center; padding: 40px 20px; color: rgba(255, 255, 255, 0.3); font-size: 11px; font-style: italic;">Start typing to see preview...</div>';
				return;
			}
			try {
				let html = text
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				html = html
					.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
					.replace(/`([^`]+)`/g, '<code>$1</code>')
					.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
					.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>')
					.replace(/__([^_]+?)__/g, '<u>$1</u>')
					.replace(/~~([^~]+?)~~/g, '<del>$1</del>')
					.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
					.replace(/!\[([^\]]*?)\]\(([^)]+?)\)/g, '<img src="$2" alt="$1" style="max-width: 100%;">')
					.replace(/^### (.+)$/gm, '<h3>$1</h3>')
					.replace(/^## (.+)$/gm, '<h2>$1</h2>')
					.replace(/^# (.+)$/gm, '<h1>$1</h1>')
					.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
					.replace(/^[\s]*[-*+] (.+)$/gm, '<li>$1</li>')
					.replace(/\n/g, '<br>');
				html = html.replace(/(<li>.*?<\/li>(?:<br>)?)+/gs, (match) => {
					const items = match.match(/<li>.*?<\/li>/gs) || [];
					return '<ul>' + items.join('') + '</ul>';
				});
				html = html
					.replace(/<br><\/h[1-3]>/g, '</h$1>')
					.replace(/<br><\/blockquote>/g, '</blockquote>')
					.replace(/<\/ul><br>/g, '</ul>')
					.replace(/<br><ul>/g, '<ul>');
				content.innerHTML = html;
			} catch (error) {
				debug.error('Preview rendering error:', error);
				content.textContent = 'Preview error: ' + error.message;
			}
		}
		destroy() {
			debug.log('Destroying TB...');
			this.cleanupFunctions.forEach(fn => {
				try {
					fn();
				} catch (error) {
					debug.warn('Cleanup error:', error);
				}
			});
			if (!location.pathname.includes('/discussion')) {
				this.livePreview?.remove();
				this.TB?.remove();
			}
		}
	}
	// POSITION MANAGER
	class PositionManager {
		static STORAGE_KEY = 'osu-panel-positions';
		static positions = {};
		static observer = null;
		static init() {
			this.loadAll();
			this.startObserving();
			debug.log('Position Manager initialized');
		}
		static loadAll() {
			try {
				const saved = localStorage.getItem(this.STORAGE_KEY);
				if (saved) {
					this.positions = JSON.parse(saved);
				}
			} catch (error) {
				debug.warn('Failed to load positions:', error);
			}
		}
		static saveAll() {
			try {
				localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.positions));
			} catch (error) {
				debug.warn('Failed to save positions:', error);
			}
		}
		static savePosition(elementId, x, y) {
			this.positions[elementId] = {
				x,
				y
			};
			this.saveAll();
		}
		static getPosition(elementId) {
			return this.positions[elementId] || null;
		}
		static startObserving() {
			this.observer = new MutationObserver((mutations) => {
				mutations.forEach(mutation => {
					mutation.addedNodes.forEach(node => {
						if (node.nodeType === 1 && node.id) { // Element with ID
							this.attachToPanel(node);
						}
					});
				});
			});
			this.observer.observe(document.body, {
				childList: true,
				subtree: false
			});
		}
		static attachToPanel(element) {
			const panelClasses = ['floating-panel', 'osu-live-preview', 'comparison-player'];
			const isPanel = panelClasses.some(cls => element.classList.contains(cls)) ||
				element.id.includes('panel') ||
				element.id.includes('preview') ||
				element.id.includes('manager') ||
				element.id.includes('comparison');
			if (!isPanel) return;
			const savedPos = this.getPosition(element.id);
			if (savedPos) {
				element.style.left = savedPos.x + 'px';
				element.style.top = savedPos.y + 'px';
				element.style.transform = 'none';
			}
			this.makeDraggable(element);
		}
		static makeDraggable(element) {
			let isDragging = false;
			let startX, startY, initialX, initialY;
			let handle = element.querySelector('.panel-header') ||
				element.querySelector('.panel-content') ||
				element.querySelector('canvas') ||
				element;
			if (handle.tagName === 'BUTTON' || handle.tagName === 'INPUT') {
				handle = element;
			}
			handle.style.cursor = 'move';
			const handleMouseDown = (e) => {
				if (e.target.tagName === 'BUTTON' ||
					e.target.tagName === 'INPUT' ||
					e.target.tagName === 'SELECT' ||
					e.target.tagName === 'TEXTAREA' ||
					e.target.closest('button') ||
					e.target.closest('input') ||
					e.target.closest('select')) {
					return;
				}
				isDragging = true;
				startX = e.clientX;
				startY = e.clientY;
				const rect = element.getBoundingClientRect();
				initialX = rect.left;
				initialY = rect.top;
				e.preventDefault();
				handle.style.cursor = 'grabbing';
			};
			const handleMouseMove = (e) => {
				if (!isDragging) return;
				const deltaX = e.clientX - startX;
				const deltaY = e.clientY - startY;
				const newX = initialX + deltaX;
				const newY = initialY + deltaY;
				const maxX = window.innerWidth - element.offsetWidth;
				const maxY = window.innerHeight - element.offsetHeight;
				element.style.transform = 'none';
				element.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
				element.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
			};
			const handleMouseUp = () => {
				if (isDragging) {
					isDragging = false;
					handle.style.cursor = 'move';
					const rect = element.getBoundingClientRect();
					this.savePosition(element.id, rect.left, rect.top);
				}
			};
			handle.addEventListener('mousedown', handleMouseDown);
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		}
		static destroy() {
			if (this.observer) {
				this.observer.disconnect();
			}
		}
	}
	// START
	function initializeTB() {
		const colorizeInterval = setInterval(() => {
			if (location.pathname.includes('/discussion')) {
				TextAnalyzer.colorizeModComments();
			}
		}, 2000);
		setTimeout(() => {
			if (location.pathname.includes('/discussion')) {
				TextAnalyzer.colorizeModComments();
			}
		}, 3000);
		if (location.pathname.includes('/discussion')) {
			setTimeout(() => {
				CollabNotesManager.init();
			}, 2000);
		}
		TBInstance = new OsuTB();
		TBInstance.init();
		PositionManager.init();
		new NotePreviewHandler();
		debug.log('Note preview handler initialized');
		if (location.pathname.includes('/discussion')) {
			const previewPlayer = new BeatmapPreviewPlayer(true);
			debug.log('Beatmap preview player auto-loaded');
			setTimeout(() => {
				RCCheckerManager.openRCChecker(true);
			}, 1500);
		}
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeTB);
	} else {
		setTimeout(initializeTB, 100);
	}
	window.addEventListener('beforeunload', () => {
		if (TBInstance) {
			TBInstance.destroy();
		}
	});
	window.addEventListener('beforeunload', (e) => {
		if (TBInstance?.state?.keyboardShortcuts) {
			return undefined;
		}
	});
})();
