import { App, TFile, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import {
	createDailyNote,
	getDailyNoteSettings,
} from "obsidian-daily-notes-interface";
import { ITelegramBotPluginAPIv1 } from 'telegram_plugin_api';

const moment = window.moment;

interface TelegramDailyLogsPluginSettings {
	timestamp_format: string;
	section_name: string;
}

const DEFAULT_SETTINGS: TelegramDailyLogsPluginSettings = {
	timestamp_format: 'YYYY-MM-DD HH:mm:ss',
	section_name: '# Лог'
}

export default class TelegramDailyLogsPlugin extends Plugin {
	settings: TelegramDailyLogsPluginSettings;
	private is_listening_for_log_text: boolean = false;
	private all_income_msg_to_daily_log: boolean = false;
	private _bot_api: ITelegramBotPluginAPIv1;

	async getDailyNote(): Promise<TFile> {
		const { folder, format } = getDailyNoteSettings();
		const date = moment();
		const filename = `${folder}/${date.format(format)}.md`;
		const daily_note_file = this.app.vault.getFileByPath(filename);
		return daily_note_file != null ? daily_note_file : createDailyNote(date);
	}

	async addDailyLog(log_message: string) {
		const f = await this.getDailyNote();
		let content = await this.app.vault.read(f!);
		const pattern = `${this.settings.section_name}\n`;
		if (!content.contains(pattern)) {
			content = content + "\n" + pattern;
		}
		const start_pos = content.indexOf(pattern);
		const nextSectionStartIndex = content.indexOf("#", start_pos + 1);
		const end_pos = nextSectionStartIndex !== -1 ? nextSectionStartIndex : content.length;
		const log_section = content.slice(start_pos, end_pos);
		const new_log_section = log_section + '\n' + log_message;
		const new_content = content.slice(0, start_pos) + new_log_section + content.slice(end_pos);
		await this.app.vault.modify(f!, new_content);
		return f
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TelegramDailyLogsSettingTab(this.app, this));

		this._bot_api = this.app.plugins.plugins['obsidian-telegram-bot-plugin'].getAPIv1();

		this._bot_api.addCommandHandler("add_log_to_daily", async (processedBefore) => {
			console.log("recieved cmd add_log_to_daily")
			if (processedBefore || this.is_listening_for_log_text) {
				return { processed: false, answer: null};
			}
			this.is_listening_for_log_text = true;
			return { processed: true, answer: "Введите текст или отправьте файл" };
		}, "daily-logs");

		this._bot_api.addCommandHandler("toggle_income_to_daily_log", async (processedBefore) => {
			console.log("recieved cmd toggle_income_to_daily_log")
			if (processedBefore || this.is_listening_for_log_text) {
				return { processed: false, answer: null};
			}			
			this.all_income_msg_to_daily_log = !this.all_income_msg_to_daily_log;
			const on_off_str: string = this.all_income_msg_to_daily_log ? "Включен" : "Выключен";
			return { processed: true, answer: on_off_str + " режим 'записывать все входящие сообщения в daily заметки'" };
		}, "daily-logs");

		this._bot_api.addTextHandler(async (text, _) => {
			if (this.is_listening_for_log_text || this.all_income_msg_to_daily_log) {
					const now = moment();					
					const log_message = `${now.format('YYYY-MM-DD HH:mm:ss')}:\n${text}\n`;
					const f = await this.addDailyLog(log_message); 
					this.is_listening_for_log_text = false;
					return { processed: false, answer: `Запись добавлена в ежедневную заметку (${f?.path})` };
			}

			return { processed: false, answer: null };
		}, "daily-logs");

		this._bot_api.addFileHandler(async (file, processedBefore, caption) => {
			if (this.is_listening_for_log_text || this.all_income_msg_to_daily_log) {
				const now = moment();
				let log_message = `\n${now.format('YYYY-MM-DD HH:mm:ss')}:\n![[${file.name}]]\n`;
				if (caption) {
					log_message += `${caption}\n`
				}
				const f = await this.addDailyLog(log_message);
				this.is_listening_for_log_text = false;
				return { processed: false, answer: `Файл сохранен в ${file.name}, ссылка добавлена в ${f?.path}` };
			}

			return { processed: false, answer: null };
		}, "daily-logs");


	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class TelegramDailyLogsSettingTab extends PluginSettingTab {
	plugin: TelegramDailyLogsPlugin;

	constructor(app: App, plugin: TelegramDailyLogsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('timestamp format')
			.setDesc('Each log entry is accompanied by a timestamp, set the format of this timestamp')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD HH:mm:ss')
				.setValue(this.plugin.settings.timestamp_format)
				.onChange(async (value) => {
					this.plugin.settings.timestamp_format = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('section name')
			.setDesc('The name of the section under which the log will be inserted')
			.addText(text => text
				.setPlaceholder('# Log')
				.setValue(this.plugin.settings.section_name)
				.onChange(async (value) => {
					this.plugin.settings.section_name = value;
					await this.plugin.saveSettings();
				}));
	}
}
