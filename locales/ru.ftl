## Access
access-denied = Извините, это закрытый бот. Попросите владельца добавить вас.

## Admin commands
admin-allow-usage = Использование: /allow <Telegram ID>
admin-deny-usage = Использование: /deny <Telegram ID>
admin-allowed = Пользователю { $id } открыт доступ.
admin-denied = У пользователя { $id } больше нет доступа.
admin-unknown-user = Пользователь { $id } не найден.
admin-users-empty = Пока нет пользователей с доступом.
admin-users-title = Пользователи с доступом:

## Hub
hub-title = EnglishCoach — чем займёмся?
hub-last-session = Последнее занятие: { $summary }
hub-learn = 📚 Учить слова
hub-review = 🔁 Повторение ({ $count })
hub-grammar = ✍️ Грамматика
hub-talk = 💬 Разговор
hub-progress = 📈 Прогресс
hub-settings = ⚙️ Настройки
hub-back = ← Назад
hub-coming-soon = Скоро появится.
hub-outdated = Это меню устарело.

## Settings
settings-title = ⚙️ Настройки
settings-ui-lang = Язык интерфейса: { $lang }
settings-explain-lang = Объяснения на: { $lang }
settings-level = Уровень: { $level }
settings-level-unset = не задан
settings-words = Слов в день: { $count }
settings-timezone = Часовой пояс: { $timezone }
settings-times = Утро { $morning } · Вечер { $evening }
settings-reminders = Напоминания: { $state }
settings-voice = Озвучка: { $state }
settings-provider = AI-провайдер: { $provider }
settings-on = вкл
settings-off = выкл
settings-btn-ui-lang = 🌐 Язык интерфейса
settings-btn-explain-lang = 💬 Объяснения
settings-btn-level = 🎓 Уровень
settings-btn-words = 📚 Слов в день
settings-btn-timezone = 🕒 Часовой пояс
settings-btn-morning = 🌅 Утреннее время
settings-btn-evening = 🌙 Вечернее время
settings-btn-reminders = 🔔 Напоминания: { $state }
settings-btn-voice = 🔊 Озвучка: { $state }
settings-btn-provider = 🤖 AI-провайдер
settings-btn-placement = Пройти тест уровня заново
settings-btn-timezone-other = ✏️ Ввести название или отправить геопозицию
settings-choose-ui-lang = Выберите язык интерфейса.
settings-choose-explain-lang = Выберите язык объяснений и переводов.
settings-choose-level = Ваш уровень: { $level }. Выберите его сами или пройдите тест.
settings-choose-words = Сколько новых слов в день?
settings-choose-timezone = Ваш часовой пояс: { $timezone }
settings-choose-morning = Утреннее занятие в { $time }. Выберите время:
settings-choose-evening = Вечернее занятие в { $time }. Выберите время:
settings-timezone-set = Часовой пояс: { $timezone }.
lang-en = English
lang-ru = Русский
lang-uk = Українська

## Settings: AI provider
provider-title = 🤖 AI-провайдер
provider-server = Сервер
provider-claude-code = Claude Code (сервер)
provider-anthropic = Ключ Anthropic
provider-openai = Ключ OpenAI
provider-openrouter = Ключ OpenRouter
provider-custom = OpenAI-совместимый…
provider-custom-key = Ключ OpenAI-совместимого API
provider-custom-host = OpenAI-совместимый ({ $host })
provider-runner = Свой компьютер — в v2
provider-model = Модель: { $model }
provider-model-default = по умолчанию
provider-key-hint = Ключ: { $hint }
provider-btn-test = 🧪 Проверить провайдера
provider-btn-model = Модель
provider-btn-reuse = Использовать сохранённый ключ
provider-btn-new-key = Ввести новый ключ
provider-setup-saved = { $provider }: ключ сохранён ({ $hint }).
provider-switched = ✅ Провайдер переключён.
provider-key-saved = ✅ Ключ проверен и сохранён.
provider-key-rejected = ❌ Провайдер отклонил этот ключ. Ничего не сохранено. Вставьте другой ключ или отмените.
provider-model-set = ✅ Модель сохранена.
provider-testing = Проверяю…
provider-test-ok = ✅ Провайдер работает ({ $ms } мс).
provider-test-bad-output = ⚠️ Провайдер ответил, но не корректным JSON ({ $ms } мс).
provider-test-failed-status = ❌ Провайдер вернул ошибку (HTTP { $status }, { $ms } мс).
provider-test-failed = ❌ Не удалось связаться с провайдером ({ $ms } мс).
model-title = Модель: { $model }
model-list-empty = Провайдер не вернул список моделей. Введите ID модели вручную.
model-page = Страница { $page } из { $pages }
model-btn-default = По умолчанию
model-btn-type = ✏️ Ввести ID модели
input-key = Вставьте { $provider } сообщением. Я сразу удалю сообщение, сохраню ключ в зашифрованном виде и буду показывать только его последние четыре символа.
input-base-url = Отправьте базовый URL вашего OpenAI-совместимого API, например https://api.example.com/v1
input-model = Отправьте ID модели (сейчас: { $model }).
input-timezone = Отправьте геопозицию (📎 → Геопозиция) или введите название часового пояса, например Europe/Kyiv.
input-cancel = Отмена
input-key-invalid = Это не похоже на API-ключ. Вставьте только сам ключ.
input-base-url-invalid = URL должен начинаться с https:// и не указывать на локальный или частный адрес.
input-model-invalid = Это не похоже на ID модели.
input-timezone-invalid = Неизвестный часовой пояс. Введите название вроде Europe/Kyiv или отправьте геопозицию.

## Progress
progress-title = 📈 Прогресс
progress-placeholder = Скоро здесь появится ваша статистика.

## Sessions
session-conflict = У вас есть незавершённое занятие. Отменить его, чтобы начать новое?
session-cancel-current = Отменить текущее занятие
session-keep-current = Продолжить
session-cancelled = Занятие отменено.
session-expired = Занятие закрыто из-за неактивности.

## Demo session
demo-start = Демо-занятие: отправьте мне 3 сообщения, и я их повторю.
demo-echo = Эхо { $n }/3: { $text }
demo-summary = Демо завершено: повторено 3 сообщения.

## LLM providers
provider-unavailable-runner = Запуск на вашем собственном компьютере появится в v2. Выберите другого провайдера в настройках.
provider-unavailable-server = Серверная LLM не настроена. Добавьте свой API-ключ в настройках.

# --- onboarding ---
onboarding-welcome = 👋 Добро пожаловать в EnglishCoach! Понемногу английского каждый день: слова, грамматика и разговор. Для начала выберите язык интерфейса и объяснений.
onboarding-provider = Какой ИИ будет вести уроки? Серверный работает сразу, а свой ключ можно подключить в настройках в любой момент.
onboarding-provider-server = Использовать серверный (по умолчанию)
onboarding-provider-own = Настроить свой провайдер в настройках
onboarding-path = Как определим ваш уровень?
onboarding-take-test = Пройти 5-минутный тест уровня
onboarding-know-level = Я знаю свой уровень
onboarding-choose-level = Выберите свой уровень:
onboarding-retake-intro = Короткий адаптивный тест из не более чем { $max } вопросов заново определит ваш уровень.
onboarding-start-test = Начать тест
onboarding-cancel = Отмена
onboarding-question = Вопрос { $n } из не более чем { $max }
onboarding-error = Тест не удалось продолжить: ИИ-провайдер не дал пригодного ответа.
onboarding-retry = Повторить
onboarding-result = Ваш уровень: { $level }
onboarding-result-fallback = По { $correct } верным ответам из { $total }.
onboarding-continue = Дальше
onboarding-words = Сколько новых слов в день?
onboarding-morning = Когда начинать утреннюю сессию?
onboarding-evening = А вечернюю?
onboarding-summary-test = Тест уровня: { $level }. { $detail }
onboarding-summary-chosen = Уровень выбран: { $level }.
onboarding-done = Добро пожаловать!
