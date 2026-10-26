## Access
access-denied = Sorry, this bot is private. Ask its owner to add you.

## Admin commands
admin-allow-usage = Usage: /allow <Telegram ID>
admin-deny-usage = Usage: /deny <Telegram ID>
admin-allowed = User { $id } is allowed.
admin-denied = User { $id } is no longer allowed.
admin-unknown-user = User { $id } is not known.
admin-users-empty = No allowed users yet.
admin-users-title = Allowed users:

## Hub
hub-title = EnglishCoach — what shall we do?
hub-last-session = Last session: { $summary }
hub-learn = 📚 Learn words
hub-review = 🔁 Review ({ $count })
hub-grammar = ✍️ Grammar
hub-talk = 💬 Talk
hub-progress = 📈 Progress
hub-settings = ⚙️ Settings
hub-back = ← Back
hub-coming-soon = Coming soon.
hub-outdated = This menu is outdated.

## Settings
settings-title = ⚙️ Settings
settings-ui-lang = Interface language: { $lang }
settings-explain-lang = Explanations in: { $lang }
settings-level = Level: { $level }
settings-level-unset = not set
settings-words = Words per day: { $count }
settings-timezone = Time zone: { $timezone }
settings-times = Morning { $morning } · Evening { $evening }
settings-reminders = Reminders: { $state }
settings-voice = Voice: { $state }
settings-provider = AI provider: { $provider }
settings-on = on
settings-off = off
settings-btn-ui-lang = 🌐 Interface language
settings-btn-explain-lang = 💬 Explanations
settings-btn-level = 🎓 Level
settings-btn-words = 📚 Words per day
settings-btn-timezone = 🕒 Time zone
settings-btn-morning = 🌅 Morning time
settings-btn-evening = 🌙 Evening time
settings-btn-reminders = 🔔 Reminders: { $state }
settings-btn-voice = 🔊 Voice: { $state }
settings-btn-provider = 🤖 AI provider
settings-btn-placement = Retake placement test
settings-btn-timezone-other = ✏️ Type a name or send your location
settings-choose-ui-lang = Choose the interface language.
settings-choose-explain-lang = Choose the language for explanations and translations.
settings-choose-level = Your level: { $level }. Choose it yourself or take the placement test.
settings-choose-words = How many new words per day?
settings-choose-timezone = Your time zone: { $timezone }
settings-choose-morning = Morning session at { $time }. Choose a time:
settings-choose-evening = Evening session at { $time }. Choose a time:
settings-timezone-set = Time zone set to { $timezone }.
lang-en = English
lang-ru = Русский
lang-uk = Українська

## Settings: AI provider
provider-title = 🤖 AI provider
provider-server = Server
provider-claude-code = Claude Code (server)
provider-anthropic = Anthropic key
provider-openai = OpenAI key
provider-openrouter = OpenRouter key
provider-custom = OpenAI-compatible…
provider-custom-key = OpenAI-compatible API key
provider-custom-host = OpenAI-compatible ({ $host })
provider-runner = Own machine — coming in v2
provider-model = Model: { $model }
provider-model-default = default
provider-key-hint = Key: { $hint }
provider-btn-test = 🧪 Test provider
provider-btn-model = Model
provider-btn-reuse = Use the saved key
provider-btn-new-key = Enter a new key
provider-setup-saved = { $provider }: a key is saved ({ $hint }).
provider-switched = ✅ Provider switched.
provider-key-saved = ✅ Key checked and saved.
provider-key-rejected = ❌ The provider rejected this key. Nothing was saved. Paste another key or cancel.
provider-model-set = ✅ Model saved.
provider-testing = Testing…
provider-test-ok = ✅ Provider works ({ $ms } ms).
provider-test-bad-output = ⚠️ The provider answered, but not with valid JSON ({ $ms } ms).
provider-test-failed-status = ❌ The provider returned an error (HTTP { $status }, { $ms } ms).
provider-test-failed = ❌ The provider could not be reached ({ $ms } ms).
model-title = Model: { $model }
model-list-empty = This provider did not list any models. Type a model ID instead.
model-page = Page { $page } of { $pages }
model-btn-default = Default
model-btn-type = ✏️ Type a model ID
input-key = Paste your { $provider } as a message. I delete the message right away, store the key encrypted and only ever show its last four characters.
input-base-url = Send the base URL of your OpenAI-compatible API, e.g. https://api.example.com/v1
input-model = Send the model ID (current: { $model }).
input-timezone = Send your location (📎 → Location) or type a time zone name, e.g. Europe/Kyiv.
input-cancel = Cancel
input-key-invalid = That does not look like an API key. Paste the key on its own.
input-base-url-invalid = The URL must start with https:// and must not point at a local or private address.
input-model-invalid = That does not look like a model ID.
input-timezone-invalid = Unknown time zone. Type a name like Europe/Kyiv or send your location.

## Progress
progress-title = 📈 Progress
progress-placeholder = Your statistics will appear here soon.

## Sessions
session-conflict = You have an unfinished session. Cancel it to start something new?
session-cancel-current = Cancel current session
session-keep-current = Keep going
session-cancelled = Session cancelled.
session-expired = Session closed after inactivity.

## Demo session
demo-start = Demo session: send me 3 messages and I will echo them back.
demo-echo = Echo { $n }/3: { $text }
demo-summary = Demo finished: 3 messages echoed.

## LLM providers
provider-unavailable-runner = Running on your own machine is coming in v2. Choose another provider in Settings.
provider-unavailable-server = The server LLM is not configured. Add your own API key in Settings.

# --- vocabulary ---
vocab-collocations = Collocations: { $list }
vocab-mnemonic = 💡 { $text }
vocab-got-it = ✅ Got it
vocab-add-word = ➕ My word
vocab-add-word-prompt = Send a word or phrase you want to learn.
vocab-add-word-cancel = Cancel
vocab-add-word-invalid = Send one word or a short phrase: letters, spaces, apostrophes and hyphens, up to 60 characters.
vocab-add-word-exists = You already have a card for “{ $word }”.
vocab-finish = Finish
vocab-retry = 🔄 Retry
vocab-start = ▶ Start
vocab-outdated = This question is no longer open.
vocab-use-buttons = Use the buttons under the last message.
vocab-llm-failed = ⚠️ The language model did not answer properly. Try again?
vocab-learn-right = ✅ Right — <b>{ $word }</b> is in your review deck now.
vocab-learn-wrong = ❌ <b>{ $word }</b> means: { $answer }. It will come back soon in Review.
vocab-learn-done = 🎉 You have learned { $count } new words today. Add your own word or finish.
vocab-learn-no-words = There are no new words left at your level. Add your own word or finish.
vocab-review-header = 🔁 { $count } cards to review.
vocab-review-right = ✅ Correct.
vocab-review-wrong = ❌ The answer: <b>{ $answer }</b>
vocab-check-unavailable = I could not check your answer automatically. The answer: <b>{ $answer }</b>
vocab-rate-prompt = How well did you know it?
vocab-rate-again = Again
vocab-rate-hard = Hard
vocab-rate-good = Good
vocab-rate-easy = Easy
vocab-pattern-prompt = ✍️ Fix this sentence, then check:
vocab-pattern-reveal = Show answer
vocab-pattern-answer = ✅ <b>{ $sentence }</b>
vocab-summary-new = +{ $count } new
vocab-summary-reviewed = { $count } reviewed
vocab-summary-accuracy = { $percent } %
vocab-summary-learn-empty = No new words this time.
vocab-review-nothing = Nothing to review right now.
