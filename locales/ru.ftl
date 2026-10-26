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

# --- vocabulary ---
vocab-collocations = Сочетания: { $list }
vocab-mnemonic = 💡 { $text }
vocab-got-it = ✅ Понятно
vocab-add-word = ➕ Своё слово
vocab-add-word-prompt = Отправьте слово или фразу, которую хотите выучить.
vocab-add-word-cancel = Отмена
vocab-add-word-invalid = Отправьте одно слово или короткую фразу: буквы, пробелы, апострофы и дефисы, до 60 символов.
vocab-add-word-exists = У вас уже есть карточка «{ $word }».
vocab-finish = Завершить
vocab-retry = 🔄 Повторить
vocab-start = ▶ Начать
vocab-outdated = Этот вопрос уже закрыт.
vocab-use-buttons = Используйте кнопки под последним сообщением.
vocab-llm-failed = ⚠️ Языковая модель ответила некорректно. Попробовать ещё раз?
vocab-learn-right = ✅ Верно — <b>{ $word }</b> теперь в вашей колоде повторения.
vocab-learn-wrong = ❌ <b>{ $word }</b> означает: { $answer }. Скоро слово вернётся в повторении.
vocab-learn-done = 🎉 Новых слов сегодня: { $count }. Добавьте своё слово или завершите.
vocab-learn-no-words = Новых слов вашего уровня больше нет. Добавьте своё слово или завершите.
vocab-review-header = 🔁 Карточек к повторению: { $count }.
vocab-review-right = ✅ Верно.
vocab-review-wrong = ❌ Ответ: <b>{ $answer }</b>
vocab-check-unavailable = Не удалось проверить ответ автоматически. Ответ: <b>{ $answer }</b>
vocab-rate-prompt = Насколько хорошо вы это знали?
vocab-rate-again = Снова
vocab-rate-hard = Трудно
vocab-rate-good = Хорошо
vocab-rate-easy = Легко
vocab-pattern-prompt = ✍️ Исправьте предложение, затем проверьте:
vocab-pattern-reveal = Показать ответ
vocab-pattern-answer = ✅ <b>{ $sentence }</b>
vocab-summary-new = новых: +{ $count }
vocab-summary-reviewed = повторено: { $count }
vocab-summary-accuracy = { $percent } %
vocab-summary-learn-empty = В этот раз без новых слов.
vocab-review-nothing = Сейчас повторять нечего.

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

# --- grammar ---
grammar-pick-topic = ✍️ Практика грамматики: 10 вопросов. Выберите тему или смешанный режим.
grammar-mixed = 🎲 Микс (рекомендуется)
grammar-topic-tenses = Времена
grammar-topic-articles = Артикли
grammar-topic-prepositions = Предлоги
grammar-topic-comparatives = Степени сравнения
grammar-topic-conditionals = Условные предложения
grammar-topic-modals = Модальные глаголы
grammar-topic-passive = Страдательный залог
grammar-topic-reported-speech = Косвенная речь
grammar-topic-gerund-infinitive = Герундий / инфинитив
grammar-topic-relative-clauses = Придаточные определительные
grammar-topic-chosen = Тема: { $topic }
grammar-question-header = ❓ Вопрос { $n } из { $total }
grammar-chosen = Ваш ответ: { $answer }
grammar-use-buttons = Ответьте кнопками выше.
grammar-verdict-correct = ✅ Верно!
grammar-verdict-partial = ❌ Почти, но есть ошибка.
grammar-verdict-wrong = ❌ Неверно.
grammar-correct-answer = Правильный ответ: { $answer }
grammar-severity = { $marker } Серьёзность: { $label }
grammar-severity-critical = критическая
grammar-severity-moderate = средняя
grammar-severity-minor = мелкая
grammar-card-added = 📌 Эта ошибка повторяется — теперь она в вашем повторении.
grammar-summary = Грамматика: { $correct }/{ $total }
grammar-summary-weak = Грамматика: { $correct }/{ $total }, слабое место: { $weak }
grammar-error-quiz = ⚠️ Не удалось подготовить следующий вопрос.
grammar-error-check = ⚠️ Не удалось проверить ответ. Отправьте его ещё раз чуть позже.
grammar-retry = 🔄 Повторить
grammar-stop = ⏹ Остановить
grammar-outdated = Этот вопрос устарел.

# --- talk ---
talk-pick-topic = О чём поговорим?
talk-topic-free = 🎲 О чём угодно
talk-topic-routine = Распорядок дня
talk-topic-family = Семья и друзья
talk-topic-food = Еда и готовка
talk-topic-travel = Путешествия
talk-topic-work = Работа и карьера
talk-topic-tech = Технологии
talk-topic-society = Общество
talk-topic-future = Будущее
talk-topic-culture = Книги и фильмы
talk-finish = ✅ Завершить
talk-corrections-title = Исправления
talk-no-errors = Ошибок нет — отличная работа!
talk-category-grammar = Грамматика
talk-category-vocabulary = Лексика
talk-category-spelling = Орфография
talk-category-word_choice = Выбор слова
talk-category-punctuation = Пунктуация
talk-category-expression = Выражение
talk-tip-phrase = Полезная фраза
talk-tip-grammar = Совет по грамматике
talk-tip-level_up = Новый уровень
talk-tip-native_pitfall = Частая ошибка
talk-error = Извините, не получилось ответить. Отправьте сообщение ещё раз.
talk-text-only = Пока я читаю здесь только текстовые сообщения.
talk-opener-fallback = Hi! What have you been up to today?
talk-summary-empty = Разговор: сообщений нет
talk-summary-title = Разговор
talk-summary-messages = { $n ->
        [one] { $n } сообщение
        [few] { $n } сообщения
        [many] { $n } сообщений
       *[other] { $n } сообщения
    }
talk-summary-corrections = { $n ->
        [one] { $n } исправление
        [few] { $n } исправления
        [many] { $n } исправлений
       *[other] { $n } исправления
    }
talk-summary-top = чаще всего: { $top }

# --- progress ---
progress-level = 🎓 Уровень: { $level }
progress-level-unset = 🎓 Уровень: пока не определён
progress-streak = 🔥 Серия: { $current } (рекорд: { $best })
progress-goal = 🎯 Сегодня: { $done }/{ $goal } новых слов · повторений: { $reviews }
progress-goal-met = ✅
progress-cards = 🗂 Карточки: новых { $new } · в изучении { $learning } · на повторении { $review }
progress-due = ⏰ К повторению: сегодня { $today } · завтра { $tomorrow }
progress-words = 📚 Выучено слов: { $count }
progress-activity = 📊 Последние 7 дней: { $spark }
progress-grammar = ✍️ Точность в грамматике: { $week } (7 дней) · { $month } (30 дней)
progress-weak-title = ⚠️ Слабые места:
progress-weak-item = • { $pattern } ×{ $count }
progress-weak-none = Ошибок пока нет — тренировать нечего.
progress-btn-weak = 🎯 Слабые места
progress-weak-screen-title = 🎯 Слабые места
progress-weak-line = { $n }. { $pattern } ×{ $count }{ "\u000A" }❌ { $wrong }{ "\u000A" }✅ { $right }
progress-btn-practice = ✍️ Потренировать
progress-practice-none = Пока нечего тренировать.
grammar-practice-intro = ✍️ Тренируем слабые места (паттернов: { $count }), по вопросу на каждый по очереди.
