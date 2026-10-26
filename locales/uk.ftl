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
hub-settings = ⚙️ Налаштування
hub-back = ← Назад
hub-coming-soon = Незабаром з'явиться.
hub-outdated = Це меню застаріло.

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
provider-test-bad-output = ⚠️ Провайдер відповів, але не коректним JSON ({ $ms } мс).
provider-test-failed-status = ❌ Провайдер повернув помилку (HTTP { $status }, { $ms } мс).
provider-test-failed = ❌ Не вдалося зв'язатися з провайдером ({ $ms } мс).
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
input-timezone-invalid = Невідомий часовий пояс. Введіть назву на кшталт Europe/Kyiv або надішліть геолокацію.

## Progress
progress-title = 📈 Прогрес
progress-placeholder = Незабаром тут з'явиться ваша статистика.

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

# --- grammar ---
grammar-pick-topic = ✍️ Практика граматики: 10 запитань. Оберіть тему або мікс.
grammar-mixed = 🎲 Мікс (рекомендовано)
grammar-topic-tenses = Часи
grammar-topic-articles = Артиклі
grammar-topic-prepositions = Прийменники
grammar-topic-comparatives = Ступені порівняння
grammar-topic-conditionals = Умовні речення
grammar-topic-modals = Модальні дієслова
grammar-topic-passive = Пасивний стан
grammar-topic-reported-speech = Непряма мова
grammar-topic-gerund-infinitive = Герундій / інфінітив
grammar-topic-relative-clauses = Означальні підрядні речення
grammar-topic-chosen = Тема: { $topic }
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
