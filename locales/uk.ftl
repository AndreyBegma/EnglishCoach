## Access
access-denied = Вибачте, це закритий бот. Попросіть власника додати вас.

## Admin commands
admin-allow-usage = Використання: /allow <Telegram ID>
admin-deny-usage = Використання: /deny <Telegram ID>
admin-allowed = Користувачу { $id } відкрито доступ.
admin-denied = Користувач { $id } більше не має доступу.
admin-unknown-user = Користувача { $id } не знайдено.
admin-users-empty = Поки немає користувачів із доступом.
admin-users-title = Користувачі з доступом:

## Hub
hub-title = EnglishCoach — чим займемося?
hub-last-session = Останнє заняття: { $summary }
hub-learn = 📚 Вчити слова
hub-review = 🔁 Повторення ({ $count })
hub-grammar = ✍️ Граматика
hub-talk = 💬 Розмова
hub-progress = 📈 Прогрес
hub-profile = 👤 Профіль
hub-settings = ⚙️ Налаштування
hub-back = ← Назад
hub-coming-soon = Незабаром з'явиться.
hub-outdated = Це меню застаріло.
hub-locked = 🧭 Уроки відкриються після тесту рівня: приблизно 20 хвилин, за один раз.
hub-locked-toast = Спершу пройдіть тест рівня.
hub-placement = 🧭 Тест рівня

## Settings
settings-title = ⚙️ Налаштування
settings-ui-lang = Мова інтерфейсу: { $lang }
settings-explain-lang = Пояснення мовою: { $lang }
settings-level = Рівень: { $level }
settings-level-unset = не задано
settings-words = Слів на день: { $count }
settings-timezone = Часовий пояс: { $timezone }
settings-times = Ранок { $morning } · Вечір { $evening }
settings-reminders = Нагадування: { $state }
settings-voice = Озвучення: { $state }
settings-english-variant = Вимова: { $variant }
settings-provider = AI-провайдер: { $provider }
settings-on = увімк
settings-off = вимк
settings-btn-ui-lang = 🌐 Мова інтерфейсу
settings-btn-explain-lang = 💬 Пояснення
settings-btn-level = 🎓 Рівень
settings-btn-words = 📚 Слів на день
settings-btn-timezone = 🕒 Часовий пояс
settings-btn-morning = 🌅 Ранковий час
settings-btn-evening = 🌙 Вечірній час
settings-btn-reminders = 🔔 Нагадування: { $state }
settings-btn-voice = 🔊 Озвучення: { $state }
settings-btn-english-variant = 🗣 Вимова: { $variant }
english-variant-us = 🇺🇸 американська
english-variant-uk = 🇬🇧 британська
settings-btn-provider = 🤖 AI-провайдер
settings-btn-placement = Пройти тест рівня ще раз
settings-btn-timezone-other = ✏️ Ввести назву або надіслати геолокацію
settings-choose-ui-lang = Оберіть мову інтерфейсу.
settings-choose-explain-lang = Оберіть мову пояснень і перекладів.
settings-choose-level = Ваш рівень: { $level }. Оберіть його самі або пройдіть тест.
settings-choose-words = Скільки нових слів на день?
settings-choose-timezone = Ваш часовий пояс: { $timezone }
settings-choose-morning = Ранкове заняття о { $time }. Оберіть час:
settings-choose-evening = Вечірнє заняття о { $time }. Оберіть час:
settings-timezone-set = Часовий пояс: { $timezone }.
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
provider-custom = OpenAI-сумісний…
provider-custom-key = Ключ OpenAI-сумісного API
provider-custom-host = OpenAI-сумісний ({ $host })
provider-runner = Власний комп'ютер — у v2
provider-model = Модель: { $model }
provider-model-default = за замовчуванням
provider-key-hint = Ключ: { $hint }
provider-btn-test = 🧪 Перевірити провайдера
provider-btn-model = Модель
provider-btn-reuse = Використати збережений ключ
provider-btn-new-key = Ввести новий ключ
provider-setup-saved = { $provider }: ключ збережено ({ $hint }).
provider-switched = ✅ Провайдера змінено.
provider-key-saved = ✅ Ключ перевірено і збережено.
provider-key-rejected = ❌ Провайдер відхилив цей ключ. Нічого не збережено. Вставте інший ключ або скасуйте.
provider-model-set = ✅ Модель збережено.
provider-testing = Перевіряю…
provider-test-ok = ✅ Провайдер працює ({ $ms } мс).
provider-current = Провайдер: { $provider }
provider-workspace = Workspace: { $workspace }
provider-btn-workspace = 🏢 ID workspace
provider-btn-workspace-clear = Скинути workspace
provider-workspace-set = ✅ ID workspace збережено. Перевірте провайдера ще раз.
provider-workspace-cleared = ✅ ID workspace скинуто.

## Provider errors (Settings test; reusable in session prompts)
provider-error-detail = Відповідь провайдера: { $detail }
provider-error-auth = ❌ Провайдер відхилив API-ключ (HTTP 401). Перевірте його або введіть новий.
provider-error-permission = ❌ Ключ не має доступу до цього (HTTP 403). Перевірте його права в консолі провайдера.
provider-error-workspace = ❌ Ключ не прив'язаний до workspace (HTTP 400). Надішліть ID workspace з Anthropic Console.
provider-error-model = ❌ Провайдер не знає цієї моделі (HTTP { $status }). Оберіть іншу модель.
provider-error-rate-limit = ⏳ Перевищено ліміт запитів (HTTP 429). Зачекайте хвилину й спробуйте знову.
provider-error-credits = ❌ На акаунті провайдера закінчилися кредити або не налаштовано оплату.
provider-error-overloaded = ⏳ Провайдер перевантажений або недоступний (HTTP { $status }). Спробуйте пізніше.
provider-error-bad-request = ❌ Провайдер відхилив запит (HTTP { $status }).
provider-error-bad-output = ⚠️ Провайдер відповів, але не коректним JSON.
provider-error-network = ❌ Не вдалося зв'язатися з провайдером.
provider-error-unknown = ❌ Провайдер повернув помилку (HTTP { $status }).
model-title = Модель: { $model }
model-list-empty = Провайдер не повернув список моделей. Введіть ID моделі вручну.
model-page = Сторінка { $page } з { $pages }
model-btn-default = За замовчуванням
model-btn-type = ✏️ Ввести ID моделі
input-key = Вставте { $provider } повідомленням. Я одразу видалю повідомлення, збережу ключ у зашифрованому вигляді й показуватиму лише його останні чотири символи.
input-base-url = Надішліть базовий URL вашого OpenAI-сумісного API, наприклад https://api.example.com/v1
input-model = Надішліть ID моделі (зараз: { $model }).
input-timezone = Надішліть геолокацію (📎 → Геолокація) або введіть назву часового поясу, наприклад Europe/Kyiv.
input-cancel = Скасувати
input-key-invalid = Це не схоже на API-ключ. Вставте лише сам ключ.
input-base-url-invalid = URL має починатися з https:// і не вказувати на локальну чи приватну адресу.
input-model-invalid = Це не схоже на ID моделі.
input-workspace = Надішліть ID workspace з Anthropic Console (Settings → Workspaces), наприклад wrkspc_01Ab… Зараз: { $workspace }.
input-workspace-invalid = Це не схоже на ID workspace. Він починається з wrkspc_.
input-timezone-invalid = Невідомий часовий пояс. Введіть назву на кшталт Europe/Kyiv або надішліть геолокацію.

## Progress
progress-title = 📈 Прогрес

## Sessions
session-conflict = У вас є незавершене заняття. Скасувати його, щоб почати нове?
session-cancel-current = Скасувати поточне заняття
session-keep-current = Продовжити
session-cancelled = Заняття скасовано.
session-expired = Заняття закрито через неактивність.

## Demo session
demo-start = Демо-заняття: надішліть мені 3 повідомлення, і я їх повторю.
demo-echo = Відлуння { $n }/3: { $text }
demo-summary = Демо завершено: повторено 3 повідомлення.

## LLM providers
provider-unavailable-runner = Запуск на вашому власному комп'ютері з'явиться у v2. Оберіть іншого провайдера в налаштуваннях.
provider-unavailable-server = Серверна LLM не налаштована. Додайте свій API-ключ у налаштуваннях.

# --- vocabulary ---
vocab-collocations = Сполучення: { $list }
vocab-word-family = Спільнокореневі: { $list }
vocab-mnemonic = 💡 { $text }
vocab-photo-credit = 📷 { $author } / { $source }
vocab-example-credit = 💬 Приклад: { $source } (CC BY 2.0 FR)
vocab-image-next = 🔄 Інша картинка
vocab-image-none = Іншої картинки для цього слова немає.
vocab-got-it = ✅ Зрозуміло
vocab-know = 💯 Знаю це слово
vocab-known = 💯 «{ $word }» позначено як відоме — більше не покажу.
vocab-known-undo = ↩️ Повернути до вивчення
vocab-known-undone = ↩️ «{ $word }» знову у вивченні.
vocab-add-word = ➕ Своє слово
vocab-add-word-prompt = Надішліть слово або фразу, яку хочете вивчити.
vocab-add-word-cancel = Скасувати
vocab-add-word-invalid = Надішліть одне слово або коротку фразу: літери, пробіли, апострофи та дефіси, до 60 символів.
vocab-add-word-exists = У вас уже є картка «{ $word }».
vocab-finish = Завершити
vocab-retry = 🔄 Повторити
vocab-start = ▶ Почати
vocab-outdated = Це питання вже закрите.
vocab-use-buttons = Скористайтеся кнопками вище.
vocab-llm-failed = ⚠️ Мовна модель відповіла некоректно. Спробувати ще раз?
vocab-learn-right = ✅ Правильно — <b>{ $word }</b> тепер у вашій колоді повторення.
vocab-learn-wrong = ❌ <b>{ $word }</b> означає: { $answer }. Незабаром слово повернеться в повторенні.
vocab-learn-done = 🎉 Нових слів сьогодні: { $count }. Додайте своє слово або завершіть.
vocab-learn-no-words = Нових слів вашого рівня більше немає. Додайте своє слово або завершіть.
vocab-review-header = 🔁 Карток до повторення: { $count }.
vocab-review-right = ✅ Правильно.
vocab-review-wrong = ❌ Відповідь: <b>{ $answer }</b>
vocab-your-answer = Ваша відповідь: <i>{ $answer }</i>
vocab-check-unavailable = Не вдалося перевірити відповідь автоматично. Відповідь: <b>{ $answer }</b>
vocab-rate-prompt = Наскільки добре ви це знали?
vocab-rate-again = Знову
vocab-rate-hard = Важко
vocab-rate-good = Добре
vocab-rate-easy = Легко
vocab-pattern-prompt = ✍️ Виправте речення, потім перевірте:
vocab-pattern-reveal = Показати відповідь
vocab-pattern-answer = ✅ <b>{ $sentence }</b>
vocab-summary-new = нових: +{ $count }
vocab-summary-reviewed = повторено: { $count }
vocab-summary-accuracy = { $percent } %
vocab-summary-learn-empty = Цього разу без нових слів.
vocab-review-nothing = Зараз повторювати нічого.
vocab-listening-prompt = 🎧 Послухайте голосове повідомлення. Що означає це слово?
vocab-listening-unavailable = Аудіо зараз недоступне. Що означає це слово?

# --- onboarding ---
onboarding-welcome = 👋 Ласкаво просимо до EnglishCoach! Потроху англійської щодня: слова, граматика й розмова. Спершу оберіть мову інтерфейсу та пояснень.
onboarding-provider = Який ШІ вестиме уроки? Серверний працює одразу, а власний ключ можна підключити в налаштуваннях будь-коли.
onboarding-provider-server = Використати серверний (за замовчуванням)
onboarding-provider-own = Налаштувати власного провайдера в налаштуваннях
onboarding-start-test = Почати тест
onboarding-cancel = Скасувати
onboarding-error = Тест не вдалося продовжити: ШІ-провайдер не дав придатної відповіді.
onboarding-retry = Повторити
onboarding-continue = Далі
onboarding-words = Скільки нових слів на день?
onboarding-morning = Коли починати ранкову сесію?
onboarding-evening = А вечірню?
onboarding-done = Ласкаво просимо!

# --- placement test ---
placement-intro = 🧭 Тепер тест рівня: шість коротких розділів — граматика, словник, читання, аудіювання, письмо й говоріння — приблизно 20 хвилин, за один раз. Уроки відкриються, коли його буде пройдено. Якщо перерватися посередині, тест почнеться спочатку.
placement-intro-retake = 🧭 Повний тест рівня знову виміряє кожну навичку: шість розділів, приблизно 20 хвилин, за один раз. Рівні зміняться лише тоді, коли ви його завершите.
placement-section = Розділ { $n }/{ $total } · { $name }
placement-section-question = Розділ { $n }/{ $total } · { $name } · { $k }/{ $of }
placement-listen = 🎧 Прослухайте голосове повідомлення нижче й дайте відповідь.
placement-task-writing = ✍️ Напишіть 3–5 речень англійською й надішліть повідомленням:
placement-task-speaking = 🎙 Дайте відповідь голосовим повідомленням англійською (30–60 секунд):
placement-needs-voice-listening = 🎧 У цьому розділі звучать короткі аудіо. Увімкніть голос, щоб його пройти, або пропустіть — тоді рівень аудіювання буде приблизним.
placement-needs-voice-speaking = 🎙 У цьому розділі потрібна голосова відповідь. Увімкніть голос, щоб його пройти, або пропустіть — тоді рівень говоріння буде приблизним.
placement-voice-on = 🔊 Увімкнути голос
placement-skip-section = Пропустити розділ
placement-writing-typed = У цьому розділі відповідь треба написати текстом.
placement-speaking-voice = Будь ласка, дайте відповідь голосовим повідомленням.
placement-writing-short = Трохи докладніше, будь ласка: 3–5 речень.
placement-speaking-short = Трохи довше, будь ласка: 30–60 секунд.
placement-result = 🎯 Ваш рівень: { $level }
placement-result-skipped = ~ — навичка, яку тест не виміряв; вона уточниться під час занять.
placement-summary = Тест рівня: { $level }.

# --- grammar ---
grammar-pick-topic = ✍️ Практика граматики: 10 запитань. Оберіть тему або мікс.
grammar-mixed = 🎲 Мікс
grammar-next-review = 🔁 Повторити: { $topic }
grammar-next-shaky = 🟡 Закріпити: { $topic }
grammar-next-new = ▶ Далі: { $topic }
grammar-next-learning = ▶ Продовжити: { $topic }
grammar-topic-chosen = Тема: { $topic }
grammar-transfer-correct = ✅ Використано правильно { $n }× { $source }
grammar-transfer-errors = ⚠️ Помилок { $source } за останні 14 днів: { $n }
grammar-transfer-in-talk = у розмові
grammar-transfer-in-writing = у письмі
grammar-transfer-in-speaking = в усному мовленні
grammar-question-header = ❓ Запитання { $n } з { $total }
grammar-chosen = Ваша відповідь: { $answer }
grammar-use-buttons = Відповідайте кнопками вище.
grammar-verdict-correct = ✅ Правильно!
grammar-verdict-partial = ❌ Майже, але є помилка.
grammar-verdict-wrong = ❌ Неправильно.
grammar-correct-answer = Правильна відповідь: { $answer }
grammar-severity = { $marker } Серйозність: { $label }
grammar-severity-critical = критична
grammar-severity-moderate = середня
grammar-severity-minor = дрібна
grammar-card-added = 📌 Ця помилка повторюється — тепер вона у вашому повторенні.
grammar-summary = Граматика: { $correct }/{ $total }
grammar-summary-weak = Граматика: { $correct }/{ $total }, слабке місце: { $weak }
grammar-error-quiz = ⚠️ Не вдалося підготувати наступне запитання.
grammar-error-check = ⚠️ Не вдалося перевірити відповідь. Надішліть її ще раз трохи згодом.
grammar-retry = 🔄 Спробувати знову
grammar-stop = ⏹ Зупинити
grammar-outdated = Це запитання застаріло.

# --- talk ---
talk-pick-topic = Про що поговоримо?
talk-topic-free = 🎲 Про що завгодно
talk-topic-routine = Розпорядок дня
talk-topic-family = Сім'я та друзі
talk-topic-food = Їжа та куховарство
talk-topic-travel = Подорожі
talk-topic-work = Робота та кар'єра
talk-topic-tech = Технології
talk-topic-society = Суспільство
talk-topic-future = Майбутнє
talk-topic-culture = Книжки та фільми
talk-finish = ✅ Завершити
talk-corrections-title = Виправлення
talk-no-errors = Помилок немає — чудова робота!
talk-category-grammar = Граматика
talk-category-vocabulary = Лексика
talk-category-spelling = Правопис
talk-category-word_choice = Вибір слова
talk-category-punctuation = Пунктуація
talk-category-expression = Вираз
talk-tip-phrase = Корисна фраза
talk-tip-grammar = Порада з граматики
talk-tip-level_up = Новий рівень
talk-tip-native_pitfall = Часта помилка
talk-error = Вибачте, не вдалося відповісти. Надішліть повідомлення ще раз.
talk-text-only = Поки що я читаю тут лише текстові повідомлення.
talk-opener-fallback = Hi! What have you been up to today?
talk-summary-empty = Розмова: повідомлень немає
talk-summary-title = Розмова
talk-summary-messages = { $n ->
        [one] { $n } повідомлення
        [few] { $n } повідомлення
        [many] { $n } повідомлень
       *[other] { $n } повідомлення
    }
talk-summary-corrections = { $n ->
        [one] { $n } виправлення
        [few] { $n } виправлення
        [many] { $n } виправлень
       *[other] { $n } виправлення
    }
talk-summary-top = найчастіше: { $top }

# --- routine ---
routine-plan-morning = ☀️ Доброго ранку! План на сьогодні:
routine-plan-evening = 🌙 Вечірня практика:
routine-plan-reviews = • карток на повторення: { $count }
routine-plan-words = • нових слів: { $count }
routine-plan-grammar = • питань з граматики: { $count }
routine-plan-empty = Зараз нічого не заплановано — коротка розмова англійською теж чудова практика.
routine-reminder = ⏰ Ціль на сьогодні ще не виконана. Кілька хвилин зараз — і серія триватиме.
routine-start-morning = ▶️ Почати ранковий сет
routine-start-evening = ▶️ Почати вечірній сет
routine-later = ⏳ Пізніше (1 год)
routine-snoozed = Нагадаю за годину.
routine-outdated = Це нагадування вже неактуальне.

# --- progress ---
progress-level = 🎓 Рівень: { $level }
progress-level-unset = 🎓 Рівень: ще не визначено
progress-skills = 📊 { $list }
progress-skill-grammar = Граматика
progress-skill-vocabulary = Словник
progress-skill-reading = Читання
progress-skill-listening = Аудіювання
progress-skill-writing = Письмо
progress-skill-speaking = Говоріння
progress-streak = 🔥 Серія: { $current } (рекорд: { $best })
progress-goal = 🎯 Сьогодні: { $done }/{ $goal } нових слів · повторень: { $reviews }
progress-goal-met = ✅
progress-cards = 🗂 Картки: нових { $new } · у вивченні { $learning } · на повторенні { $review }
progress-due = ⏰ До повторення: сьогодні { $today } · завтра { $tomorrow }
progress-words = 📚 Вивчено слів: { $count }
progress-known = 💯 Відомо слів: { $count }
progress-activity = 📊 Останні 7 днів: { $spark }
progress-grammar = ✍️ Точність у граматиці: { $week } (7 днів) · { $month } (30 днів)
progress-weak-title = ⚠️ Слабкі місця:
progress-weak-item = • { $pattern } ×{ $count }
progress-weak-none = Помилок поки немає — тренувати нічого.
progress-btn-weak = 🎯 Слабкі місця
progress-weak-screen-title = 🎯 Слабкі місця
progress-weak-line = { $n }. { $pattern } ×{ $count }{ "\u000A" }❌ { $wrong }{ "\u000A" }✅ { $right }

# --- profile ---
profile-title = 👤 Профіль
profile-level = ⭐ Рівень { $level } · { $xp } XP
profile-xp-bar = { $bar } { $into }/{ $needed } XP до рівня { $next }
profile-streak = 🔥 Серія: { $current } (рекорд: { $best })
profile-cefr = 🎓 Англійська: { $level }
profile-cefr-unset = 🎓 Англійська: рівень ще не визначено
profile-skill = • { $skill }: { $level }
profile-skill-seeded = • { $skill }: ~{ $level }
profile-achievements-title = 🏆 Останні досягнення
profile-achievement = • { $title }
profile-achievements-none = Досягнень поки немає — перше вже за одне заняття.
profile-achievements-btn = 🏆 Досягнення
profile-totals-title = 📦 За весь час
profile-totals = 📚 вивчено слів: { $words } · 🔁 повторень: { $reviews } · ✍️ відповідей з граматики: { $grammar } · 🎯 днів із виконаною ціллю: { $days }

# --- achievements ---
achievements-title = 🏆 Досягнення · відкрито { $unlocked } з { $total }
achievements-page = Сторінка { $page } з { $pages }
achievements-progress = { $bar } { $value }/{ $threshold } → { $title }
achievements-topics = 🧩 Опановано тем граматики: { $count } з { $total }
achievements-secrets = 🔒 Знайдено секретних досягнень: { $count } з { $total }
achievements-prev = ◀️ Назад
achievements-next = Далі ▶️
achievements-back = 👤 Профіль
hub-achievements-unlocked = 🏆 Відкрито: { $list }
hub-achievements-more = { $list } і ще { $count }

progress-btn-practice = ✍️ Потренувати
progress-practice-none = Поки нічого тренувати.
grammar-practice-intro = ✍️ Тренуємо слабкі місця (патернів: { $count }), по запитанню на кожен по черзі.

# --- voice ---
voice-listen = 🔊 Послухати
voice-listen-example = 🔊 Приклад
voice-transcript = 🎤 { $text }
voice-needs-key = Для голосових відповідей і вимови потрібен OpenAI-сумісний API-ключ. Додайте його в Налаштування → Провайдер і спробуйте знову. А поки напишіть відповідь текстом.
voice-too-long = Голосове повідомлення задовге. Вкладіться в { $seconds } секунд або напишіть відповідь текстом.
voice-stt-failed = Не вдалося розпізнати голосове повідомлення. Спробуйте ще раз або напишіть відповідь текстом.
voice-empty = У голосовому повідомленні не чути слів. Спробуйте ще раз або напишіть відповідь текстом.
voice-tts-failed = Зараз не вдалося озвучити слово. Спробуйте пізніше.
voice-disabled = Озвучення вимкнено. Увімкніть його в Налаштуваннях.
voice-outdated = Ця кнопка більше не доступна.
voice-board-running = 🔊 Озвучення списку слів — триває
voice-board-idle = 🔊 Озвучення списку слів — пауза до наступного запуску
voice-board-words = Слова: { $done } / { $total } ({ $percent }%) { $bar }
voice-board-examples = Приклади: { $done } / { $total } ({ $percent }%) { $bar }
voice-board-remaining = Залишилось: { $remaining } · ETA: { $eta }
voice-board-eta = приблизно { $hours } год { $minutes } хв при { $rate } на годину
voice-board-eta-unknown = невідомо (за останню годину нічого не створено)
voice-board-eta-none = готово
voice-board-recent = Створено сьогодні: { $today } · за 24 год: { $day }
voice-board-failures = Помилок сьогодні: { $count }
voice-board-engine = Рушій: { $engine } · голос: { $voices }
voice-board-updated = Оновлено: { $time } UTC

# --- answer feedback (one answer at a time) ---
answer-accepted = Відповідь «{ $answer }» прийнято
answer-chosen = ✅ { $answer }
answer-preparing = ⏳ Готую наступне питання…
answer-busy = Зачекайте, готую наступне питання
answer-stale = На це питання вже є відповідь
answer-starting = ⏳ Готую…
settings-models-loading = ⏳ Завантажую моделі…

## Learner profile (onboarding and Settings → Profile & goals)

onboarding-goals = 🎯 Навіщо вам англійська? Позначте все, що підходить, і натисніть «Далі».
onboarding-goals-empty = Оберіть хоча б одну ціль
onboarding-interests = 💡 Чим ви захоплюєтеся? Позначте теми або напишіть свої через кому (до { $max }). Приклади й тексти будуть про них.
onboarding-profession = 💼 Чим ви займаєтеся? Напишіть професію чи посаду — або пропустіть.
onboarding-next = Далі ›
onboarding-skip = Пропустити
onboarding-use-buttons = Будь ласка, скористайтеся кнопками вище.
goal-it = 💻 IT
goal-travel = ✈️ Подорожі
goal-work_business = 💼 Робота й бізнес
goal-exam = 📝 Іспит
goal-everyday = 🗣 Повсякденна англійська
goal-relocation = 🏠 Переїзд
interest-technology = Технології
interest-music = Музика
interest-movies = Кіно й серіали
interest-books = Книжки
interest-sports = Спорт
interest-travel = Подорожі
interest-cooking = Кулінарія
interest-games = Ігри
interest-science = Наука
interest-business = Бізнес
interest-art = Мистецтво
interest-health = Здоров'я й фітнес
settings-btn-profile = 👤 Профіль і цілі
profile-goals-title = 👤 Профіль і цілі
profile-goals = Цілі: { $goals }
profile-interests = Інтереси: { $interests }
profile-profession = Професія: { $profession }
profile-none = —
profile-btn-interests = 💡 Інтереси
profile-btn-profession = 💼 Професія
profile-btn-clear-profession = Очистити професію
profile-interests-title = 💡 Інтереси, до { $max }. Натисніть на тему, щоб додати чи прибрати її, або напишіть свої.
profile-btn-type-interests = ✏️ Написати свої
profile-btn-clear = Очистити все
profile-interests-full = Не більше { $max } інтересів
input-interests = Надішліть інтереси через кому, наприклад: футбол, джаз, стартапи (до { $max }).
input-profession = Надішліть професію чи посаду (зараз: { $profession }).
input-interests-invalid = Надішліть короткі теми через кому, кожна до 40 символів.
input-profession-invalid = Надішліть професію одним рядком, до 80 символів.

## Streak: freezes, restore, the burning reminder
profile-freezes = 🧊 Заморозки: { $count }/{ $max } · XP можна витратити: { $xp }
profile-freeze-buy = 🧊 Купити заморозку · { $price } XP
profile-freeze-bought = 🧊 Заморозку куплено: пропущений день не перерве серію.
profile-freeze-full = У вас уже максимум заморозок.
profile-freeze-poor = Заморозка коштує { $price } XP — поки бракує XP.
hub-streak-restore = 🩹 Учора серія ({ $days } дн.) перервалася. Виконайте сьогодні подвійну денну ціль, щоб її повернути.
routine-reminder-burning = 🔥 Серія ({ $days } дн.) згорить через { $hours } год. Кілька хвилин зараз — і вона триватиме.
routine-reminder-restore = 🩹 Серію ({ $days } дн.) ще можна врятувати: подвійна денна ціль у найближчі { $hours } год поверне її.
