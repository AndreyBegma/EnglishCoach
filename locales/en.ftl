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

# --- onboarding ---
onboarding-welcome = 👋 Welcome to EnglishCoach! A little English every day, with words, grammar and conversation. First, choose the language for the interface and explanations.
onboarding-provider = Which AI should run your lessons? The server's works out of the box; you can switch to your own key in Settings at any time.
onboarding-provider-server = Use the server (default)
onboarding-provider-own = Set up my own provider in Settings
onboarding-path = How shall we find your level?
onboarding-take-test = Take a 5-minute placement test
onboarding-know-level = I know my level
onboarding-choose-level = Pick your level:
onboarding-retake-intro = A short adaptive test of up to { $max } questions will find your level again.
onboarding-start-test = Start the test
onboarding-cancel = Cancel
onboarding-question = Question { $n } of up to { $max }
onboarding-error = The test could not continue: the AI provider did not give a usable answer.
onboarding-retry = Try again
onboarding-result = Your level: { $level }
onboarding-result-fallback = Based on { $correct } correct answers out of { $total }.
onboarding-continue = Continue
onboarding-words = How many new words per day?
onboarding-morning = When shall I start your morning session?
onboarding-evening = And your evening session?
onboarding-summary-test = Placement test: { $level }. { $detail }
onboarding-summary-chosen = Level set: { $level }.
onboarding-done = Welcome aboard!

# --- grammar ---
grammar-pick-topic = ✍️ Grammar practice: 10 questions. Pick a topic or practise a mix.
grammar-mixed = 🎲 Mixed (recommended)
grammar-topic-tenses = Tenses
grammar-topic-articles = Articles
grammar-topic-prepositions = Prepositions
grammar-topic-comparatives = Comparatives
grammar-topic-conditionals = Conditionals
grammar-topic-modals = Modal verbs
grammar-topic-passive = Passive voice
grammar-topic-reported-speech = Reported speech
grammar-topic-gerund-infinitive = Gerund / infinitive
grammar-topic-relative-clauses = Relative clauses
grammar-topic-chosen = Topic: { $topic }
grammar-question-header = ❓ Question { $n } of { $total }
grammar-chosen = Your answer: { $answer }
grammar-use-buttons = Please answer with the buttons above.
grammar-verdict-correct = ✅ Correct!
grammar-verdict-partial = ❌ Almost, but there is a slip.
grammar-verdict-wrong = ❌ Not quite.
grammar-correct-answer = Correct answer: { $answer }
grammar-severity = { $marker } Severity: { $label }
grammar-severity-critical = critical
grammar-severity-moderate = moderate
grammar-severity-minor = minor
grammar-card-added = 📌 This pattern keeps coming up — it is now in your Review.
grammar-summary = Grammar: { $correct }/{ $total }
grammar-summary-weak = Grammar: { $correct }/{ $total }, weak: { $weak }
grammar-error-quiz = ⚠️ I could not prepare the next question.
grammar-error-check = ⚠️ I could not check your answer. Send it again in a moment.
grammar-retry = 🔄 Try again
grammar-stop = ⏹ Stop
grammar-outdated = This question is outdated.

# --- talk ---
talk-pick-topic = What shall we talk about?
talk-topic-free = 🎲 Anything
talk-topic-routine = Daily routine
talk-topic-family = Family & friends
talk-topic-food = Food & cooking
talk-topic-travel = Travel
talk-topic-work = Work & career
talk-topic-tech = Technology
talk-topic-society = Society
talk-topic-future = The future
talk-topic-culture = Books & films
talk-finish = ✅ Finish
talk-corrections-title = Corrections
talk-no-errors = No errors — nice work!
talk-category-grammar = Grammar
talk-category-vocabulary = Vocabulary
talk-category-spelling = Spelling
talk-category-word_choice = Word choice
talk-category-punctuation = Punctuation
talk-category-expression = Expression
talk-tip-phrase = Useful phrase
talk-tip-grammar = Grammar tip
talk-tip-level_up = Level up
talk-tip-native_pitfall = Common mistake
talk-error = Sorry, I could not answer that. Please send your message again.
talk-text-only = I can only read text messages here for now.
talk-opener-fallback = Hi! What have you been up to today?
talk-summary-empty = Talk: no messages
talk-summary-title = Talk
talk-summary-messages = { $n ->
        [one] 1 message
       *[other] { $n } messages
    }
talk-summary-corrections = { $n ->
        [one] 1 correction
       *[other] { $n } corrections
    }
talk-summary-top = top: { $top }
