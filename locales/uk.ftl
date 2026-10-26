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
