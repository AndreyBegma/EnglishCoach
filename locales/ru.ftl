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
hub-profile = 👤 Профиль
hub-settings = ⚙️ Настройки
hub-back = ← Назад
hub-coming-soon = Скоро появится.
hub-outdated = Это меню устарело.
hub-locked = 🧭 Уроки откроются после теста уровня: примерно 20 минут, за один раз.
hub-locked-toast = Сначала пройдите тест уровня.
hub-placement = 🧭 Тест уровня

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
settings-english-variant = Произношение: { $variant }
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
settings-btn-english-variant = 🗣 Произношение: { $variant }
english-variant-us = 🇺🇸 американское
english-variant-uk = 🇬🇧 британское
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
# Desired retention (FSRS)
settings-retention = Цель запоминания: { $percent }%
settings-btn-retention = 🎯 Цель запоминания
settings-choose-retention = Цель запоминания: { $percent }%. Насколько уверенно вы хотите помнить слово или тему, когда оно вернётся на повторение? Выше — повторений больше; ниже — повторений меньше, но и забывается больше.
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
provider-current = Провайдер: { $provider }
provider-workspace = Workspace: { $workspace }
provider-btn-workspace = 🏢 ID workspace
provider-btn-workspace-clear = Сбросить workspace
provider-workspace-set = ✅ ID workspace сохранён. Проверьте провайдера ещё раз.
provider-workspace-cleared = ✅ ID workspace сброшен.

## Provider errors (Settings test; reusable in session prompts)
provider-error-detail = Ответ провайдера: { $detail }
provider-error-auth = ❌ Провайдер отклонил API-ключ (HTTP 401). Проверьте его или введите новый.
provider-error-permission = ❌ У ключа нет доступа к этому (HTTP 403). Проверьте его права в консоли провайдера.
provider-error-workspace = ❌ Ключ не привязан к workspace (HTTP 400). Отправьте ID workspace из Anthropic Console.
provider-error-model = ❌ Провайдер не знает эту модель (HTTP { $status }). Выберите другую модель.
provider-error-rate-limit = ⏳ Превышен лимит запросов (HTTP 429). Подождите минуту и попробуйте снова.
provider-error-credits = ❌ На аккаунте провайдера закончились кредиты или не настроена оплата.
provider-error-overloaded = ⏳ Провайдер перегружен или недоступен (HTTP { $status }). Попробуйте позже.
provider-error-bad-request = ❌ Провайдер отклонил запрос (HTTP { $status }).
provider-error-bad-output = ⚠️ Провайдер ответил, но не корректным JSON.
provider-error-network = ❌ Не удалось связаться с провайдером.
provider-error-unknown = ❌ Провайдер вернул ошибку (HTTP { $status }).
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
input-workspace = Отправьте ID workspace из Anthropic Console (Settings → Workspaces), например wrkspc_01Ab… Сейчас: { $workspace }.
input-workspace-invalid = Это не похоже на ID workspace. Он начинается с wrkspc_.
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
vocab-word-family = Однокоренные: { $list }
vocab-mnemonic = 💡 { $text }
vocab-photo-credit = 📷 { $author } / { $source }
vocab-example-credit = 💬 Пример: { $source } (CC BY 2.0 FR)
vocab-image-next = 🔄 Другая картинка
vocab-image-none = Другой картинки для этого слова нет.
vocab-got-it = ✅ Понятно
vocab-know = 💯 Знаю это слово
vocab-known = 💯 «{ $word }» отмечено как известное — больше не покажу.
vocab-known-undo = ↩️ Вернуть в изучение
vocab-known-undone = ↩️ «{ $word }» снова в изучении.
vocab-add-word = ➕ Своё слово
vocab-add-word-prompt = Отправьте слово или фразу, которую хотите выучить.
vocab-add-word-cancel = Отмена
vocab-add-word-invalid = Отправьте одно слово или короткую фразу: буквы, пробелы, апострофы и дефисы, до 60 символов.
vocab-add-word-exists = У вас уже есть карточка «{ $word }».
vocab-finish = Завершить
vocab-retry = 🔄 Повторить
vocab-start = ▶ Начать
vocab-outdated = Этот вопрос уже закрыт.
vocab-use-buttons = Используйте кнопки выше.
vocab-llm-failed = ⚠️ Языковая модель ответила некорректно. Попробовать ещё раз?
vocab-learn-right = ✅ Верно — <b>{ $word }</b> теперь в вашей колоде повторения.
vocab-learn-wrong = ❌ <b>{ $word }</b> означает: { $answer }. Скоро слово вернётся в повторении.
vocab-learn-done = 🎉 Новых слов сегодня: { $count }. Добавьте своё слово или завершите.
vocab-learn-no-words = Новых слов вашего уровня больше нет. Добавьте своё слово или завершите.
vocab-review-header = 🔁 Карточек к повторению: { $count }.
vocab-review-right = ✅ Верно.
vocab-review-wrong = ❌ Ответ: <b>{ $answer }</b>
vocab-your-answer = Ваш ответ: <i>{ $answer }</i>
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
onboarding-start-test = Начать тест
onboarding-cancel = Отмена
onboarding-error = Тест не удалось продолжить: ИИ-провайдер не дал пригодного ответа.
onboarding-retry = Повторить
onboarding-continue = Дальше
onboarding-words = Сколько новых слов в день?
onboarding-morning = Когда начинать утреннюю сессию?
onboarding-evening = А вечернюю?
onboarding-done = Добро пожаловать!

# --- placement test ---
placement-intro = 🧭 Теперь тест уровня: шесть коротких разделов — грамматика, словарь, чтение, аудирование, письмо и говорение — примерно 20 минут, за один раз. Уроки откроются, когда он будет пройден. Если прерваться на середине, тест начнётся сначала.
placement-intro-retake = 🧭 Полный тест уровня заново измерит каждый навык: шесть разделов, примерно 20 минут, за один раз. Уровни изменятся только когда вы его закончите.
placement-section = Раздел { $n }/{ $total } · { $name }
placement-section-question = Раздел { $n }/{ $total } · { $name } · { $k }/{ $of }
placement-listen = 🎧 Послушайте голосовое сообщение ниже и ответьте.
placement-task-writing = ✍️ Напишите 3–5 предложений по-английски и отправьте сообщением:
placement-task-speaking = 🎙 Ответьте голосовым сообщением по-английски (30–60 секунд):
placement-needs-voice-listening = 🎧 В этом разделе звучат короткие аудио. Включите голос, чтобы его пройти, или пропустите — тогда уровень аудирования будет приблизительным.
placement-needs-voice-speaking = 🎙 В этом разделе нужен голосовой ответ. Включите голос, чтобы его пройти, или пропустите — тогда уровень говорения будет приблизительным.
placement-voice-on = 🔊 Включить голос
placement-skip-section = Пропустить раздел
placement-writing-typed = В этом разделе ответ нужно написать текстом.
placement-speaking-voice = Пожалуйста, ответьте голосовым сообщением.
placement-writing-short = Чуть подробнее, пожалуйста: 3–5 предложений.
placement-speaking-short = Чуть дольше, пожалуйста: 30–60 секунд.
placement-result = 🎯 Ваш уровень: { $level }
placement-result-skipped = ~ — навык, который тест не измерил; он уточнится по ходу занятий.
placement-summary = Тест уровня: { $level }.

# --- grammar ---
grammar-pick-topic = ✍️ Практика грамматики: 10 вопросов. Выберите тему или смешанный режим.
grammar-mixed = 🎲 Микс
grammar-next-review = 🔁 Повторить: { $topic }
grammar-next-shaky = 🟡 Закрепить: { $topic }
grammar-next-new = ▶ Дальше: { $topic }
grammar-next-learning = ▶ Продолжить: { $topic }
grammar-topic-chosen = Тема: { $topic }
grammar-transfer-correct = ✅ Использовано верно { $n }× { $source }
grammar-transfer-errors = ⚠️ Ошибок { $source } за последние 14 дней: { $n }
grammar-transfer-in-talk = в разговоре
grammar-transfer-in-writing = в письме
grammar-transfer-in-speaking = в устной речи
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

# --- routine ---
routine-plan-morning = ☀️ Доброе утро! План на сегодня:
routine-plan-evening = 🌙 Вечерняя практика:
routine-plan-reviews = • карточек на повторение: { $count }
routine-plan-words = • новых слов: { $count }
routine-plan-grammar = • вопросов по грамматике: { $count }
routine-plan-empty = Сейчас ничего не запланировано — короткий разговор на английском тоже отличная практика.
routine-reminder = ⏰ Цель на сегодня ещё не выполнена. Пара минут сейчас — и серия продолжится.
routine-start-morning = ▶️ Начать утренний сет
routine-start-evening = ▶️ Начать вечерний сет
routine-later = ⏳ Позже (1 ч)
routine-snoozed = Напомню через час.
routine-outdated = Это напоминание уже неактуально.

# --- progress ---
progress-level = 🎓 Уровень: { $level }
progress-level-unset = 🎓 Уровень: пока не определён
progress-skills = 📊 { $list }
progress-skill-grammar = Грамматика
progress-skill-vocabulary = Словарь
progress-skill-reading = Чтение
progress-skill-listening = Аудирование
progress-skill-writing = Письмо
progress-skill-speaking = Говорение
progress-streak = 🔥 Серия: { $current } (рекорд: { $best })
progress-goal = 🎯 Сегодня: { $done }/{ $goal } новых слов · повторений: { $reviews }
progress-goal-met = ✅
progress-cards = 🗂 Карточки: новых { $new } · в изучении { $learning } · на повторении { $review }
progress-due = ⏰ К повторению: сегодня { $today } · завтра { $tomorrow }
progress-words = 📚 Выучено слов: { $count }
progress-known = 💯 Известно слов: { $count }
progress-activity = 📊 Последние 7 дней: { $spark }
progress-grammar = ✍️ Точность в грамматике: { $week } (7 дней) · { $month } (30 дней)
progress-weak-title = ⚠️ Слабые места:
progress-weak-item = • { $pattern } ×{ $count }
progress-weak-none = Ошибок пока нет — тренировать нечего.
progress-btn-weak = 🎯 Слабые места
progress-weak-screen-title = 🎯 Слабые места
progress-weak-line = { $n }. { $pattern } ×{ $count }{ "\u000A" }❌ { $wrong }{ "\u000A" }✅ { $right }

# --- profile ---
profile-title = 👤 Профиль
profile-level = ⭐ Уровень { $level } · { $xp } XP
profile-xp-bar = { $bar } { $into }/{ $needed } XP до уровня { $next }
profile-streak = 🔥 Серия: { $current } (рекорд: { $best })
profile-cefr = 🎓 Английский: { $level }
profile-cefr-unset = 🎓 Английский: уровень пока не определён
profile-skill = • { $skill }: { $level }
profile-skill-seeded = • { $skill }: ~{ $level }
profile-achievements-title = 🏆 Последние достижения
profile-achievement = • { $title }
profile-achievements-none = Достижений пока нет — первое уже через одно занятие.
profile-achievements-btn = 🏆 Достижения
profile-totals-title = 📦 За всё время
profile-totals = 📚 выучено слов: { $words } · 🔁 повторений: { $reviews } · ✍️ ответов по грамматике: { $grammar } · 🎯 дней с выполненной целью: { $days }

# --- achievements ---
achievements-title = 🏆 Достижения · открыто { $unlocked } из { $total }
achievements-page = Страница { $page } из { $pages }
achievements-progress = { $bar } { $value }/{ $threshold } → { $title }
achievements-topics = 🧩 Освоено тем грамматики: { $count } из { $total }
achievements-secrets = 🔒 Найдено секретных достижений: { $count } из { $total }
achievements-prev = ◀️ Назад
achievements-next = Дальше ▶️
achievements-back = 👤 Профиль
hub-achievements-unlocked = 🏆 Открыто: { $list }
hub-achievements-more = { $list } и ещё { $count }

progress-btn-practice = ✍️ Потренировать
progress-practice-none = Пока нечего тренировать.
grammar-practice-intro = ✍️ Тренируем слабые места (паттернов: { $count }), по вопросу на каждый по очереди.

# --- voice ---
voice-listen = 🔊 Послушать
voice-listen-example = 🔊 Пример
voice-transcript = 🎤 { $text }
voice-needs-key = Для голосовых ответов и произношения нужен OpenAI-совместимый API-ключ. Добавьте его в Настройки → Провайдер и попробуйте снова. А пока напишите ответ текстом.
voice-too-long = Голосовое сообщение слишком длинное. Уложитесь в { $seconds } секунд или напишите ответ текстом.
voice-stt-failed = Не получилось распознать голосовое сообщение. Попробуйте ещё раз или напишите ответ текстом.
voice-empty = В голосовом сообщении не слышно слов. Попробуйте ещё раз или напишите ответ текстом.
voice-tts-failed = Сейчас не получилось озвучить слово. Попробуйте позже.
voice-disabled = Озвучка выключена. Включите её в Настройках.
voice-outdated = Эта кнопка больше не доступна.
voice-board-running = 🔊 Озвучка списка слов — идёт
voice-board-idle = 🔊 Озвучка списка слов — пауза до следующего запуска
voice-board-words = Слова: { $done } / { $total } ({ $percent }%) { $bar }
voice-board-examples = Примеры: { $done } / { $total } ({ $percent }%) { $bar }
voice-board-remaining = Осталось: { $remaining } · ETA: { $eta }
voice-board-eta = примерно { $hours } ч { $minutes } мин при { $rate } в час
voice-board-eta-unknown = неизвестно (за последний час ничего не создано)
voice-board-eta-none = готово
voice-board-recent = Создано сегодня: { $today } · за 24 ч: { $day }
voice-board-failures = Ошибок сегодня: { $count }
voice-board-engine = Движок: { $engine } · голос: { $voices }
voice-board-updated = Обновлено: { $time } UTC

# --- answer feedback (one answer at a time) ---
answer-accepted = Ответ «{ $answer }» принят
answer-chosen = ✅ { $answer }
answer-preparing = ⏳ Готовлю следующий вопрос…
answer-busy = Подождите, готовлю следующий вопрос
answer-stale = На этот вопрос уже есть ответ
answer-starting = ⏳ Готовлю…
settings-models-loading = ⏳ Загружаю модели…

## Learner profile (onboarding and Settings → Profile & goals)

onboarding-goals = 🎯 Зачем вам английский? Отметьте всё, что подходит, и нажмите «Дальше».
onboarding-goals-empty = Выберите хотя бы одну цель
onboarding-interests = 💡 Чем вы увлекаетесь? Отметьте темы или напишите свои через запятую (до { $max }). Примеры и тексты будут про них.
onboarding-profession = 💼 Чем вы занимаетесь? Напишите профессию или должность — или пропустите.
onboarding-next = Дальше ›
onboarding-skip = Пропустить
onboarding-use-buttons = Пожалуйста, используйте кнопки выше.
goal-it = 💻 IT
goal-travel = ✈️ Путешествия
goal-work_business = 💼 Работа и бизнес
goal-exam = 📝 Экзамен
goal-everyday = 🗣 Повседневный английский
goal-relocation = 🏠 Переезд
interest-technology = Технологии
interest-music = Музыка
interest-movies = Кино и сериалы
interest-books = Книги
interest-sports = Спорт
interest-travel = Путешествия
interest-cooking = Кулинария
interest-games = Игры
interest-science = Наука
interest-business = Бизнес
interest-art = Искусство
interest-health = Здоровье и фитнес
settings-btn-profile = 👤 Профиль и цели
profile-goals-title = 👤 Профиль и цели
profile-goals = Цели: { $goals }
profile-interests = Интересы: { $interests }
profile-profession = Профессия: { $profession }
profile-none = —
profile-btn-interests = 💡 Интересы
profile-btn-profession = 💼 Профессия
profile-btn-clear-profession = Очистить профессию
profile-interests-title = 💡 Интересы, до { $max }. Нажмите на тему, чтобы добавить или убрать её, или напишите свои.
profile-btn-type-interests = ✏️ Написать свои
profile-btn-clear = Очистить всё
profile-interests-full = Не больше { $max } интересов
input-interests = Отправьте интересы через запятую, например: футбол, джаз, стартапы (до { $max }).
input-profession = Отправьте профессию или должность (сейчас: { $profession }).
input-interests-invalid = Отправьте короткие темы через запятую, каждая до 40 символов.
input-profession-invalid = Отправьте профессию одной строкой, до 80 символов.

## Streak: freezes, restore, the burning reminder
profile-freezes = 🧊 Заморозки: { $count }/{ $max } · XP можно потратить: { $xp }
profile-freeze-buy = 🧊 Купить заморозку · { $price } XP
profile-freeze-bought = 🧊 Заморозка куплена: пропущенный день не прервёт серию.
profile-freeze-full = У вас уже максимум заморозок.
profile-freeze-poor = Заморозка стоит { $price } XP — пока не хватает XP.
hub-streak-restore = 🩹 Вчера серия ({ $days } дн.) прервалась. Выполните сегодня двойную дневную цель, чтобы её вернуть.
routine-reminder-burning = 🔥 Серия ({ $days } дн.) сгорит через { $hours } ч. Пара минут сейчас — и она продолжится.
routine-reminder-restore = 🩹 Серию ({ $days } дн.) ещё можно спасти: двойная дневная цель в ближайшие { $hours } ч вернёт её.
