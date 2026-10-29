/* Recipe-extraction prompt and output schema used by the server.
   The page (public/index.html) keeps a copy for the "use my own API key" path –
   if you change one, change the other. */

export const AI_MODEL = 'claude-opus-5-5';

const CATEGORIES = ['Main', 'Side', 'Dessert', 'Appetizer', 'Breakfast', 'Bread', 'Sauce', 'Drink', 'Other'];
const KNOWN_EQUIPMENT = ['Stand Mixer', 'Hand Mixer', 'Food Processor', 'Blender', 'Stockpot', 'Dutch Oven', 'Saucepan', 'Skillet',
  'Griddle', 'Waffle Iron', 'Sheet Pan', 'Roasting Pan', 'Casserole Dish', 'Pie Dish', 'Cake Pan', 'Muffin Tin', 'Loaf Pan',
  'Rolling Pin', 'Piping Bag', 'Meat Thermometer', 'Candy Thermometer', 'Slow Cooker'];
const REVIEWABLE = ['name', 'category', 'prepTime', 'activeTime', 'passiveTime', 'ovenTemp'];
const minutes = (description) => ({ type: 'integer', description: description + ' Whole minutes; 0 if none.' });

export const AI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['recipes'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'category', 'prepTime', 'waitTime', 'waitLabel', 'activeTime', 'activeOnStove', 'passiveTime', 'passiveWhere',
          'ovenTemp', 'batches', 'fullOven', 'restTime', 'equipment', 'notes', 'concurrent', 'uncertainFields'],
        properties: {
          name: { type: 'string', description: 'Recipe title as written.' },
          category: { type: 'string', enum: CATEGORIES },
          prepTime: minutes('Hands-on prep before any cooking or chilling: chopping, measuring, mixing, assembling.'),
          waitTime: minutes('Hands-off wait BEFORE cooking: chilling dough, rising/proofing, marinating, brining, soaking.'),
          waitLabel: { type: 'string', description: 'Short label for the wait, e.g. "Chill dough", "Let dough rise", "Marinate". Empty if waitTime is 0.' },
          activeTime: minutes('Hands-on cooking that needs attention: sautéing, stirring, searing, frying, flipping pancakes, rolling and cutting dough, boiling candy.'),
          activeOnStove: { type: 'boolean', description: 'True if the active step uses a stovetop burner; false if it is counter work such as rolling or shaping.' },
          passiveTime: minutes('Unattended cooking for ONE batch: oven bake/roast time (sum all stages, e.g. 15 min at 425°F + 45 min at 350°F = 60), a hands-off simmer, or time to set/chill in the fridge for no-cook dishes. Use the upper end of ranges.'),
          passiveWhere: { type: 'string', enum: ['oven', 'stovetop', 'counter'], description: 'Where the passive step happens. counter = fridge/counter/no cooking.' },
          ovenTemp: { type: 'integer', description: 'Oven temperature in °F (convert °C: F = C×9/5+32, round to 5). For multi-stage bakes use the temperature for the longest stage. 0 if no oven.' },
          batches: { type: 'integer', description: 'Number of sequential oven loads/trays needed (e.g. 3 dozen cookies at 1 dozen per sheet = 3). 1 if everything bakes at once.' },
          fullOven: { type: 'boolean', description: 'True only if the dish fills the whole oven (e.g. a large turkey).' },
          restTime: minutes('After cooking and before serving: resting meat, cooling a pie or cookies, setting.'),
          equipment: { type: 'array', items: { type: 'string' }, description: `Required equipment, using these names where they fit: ${KNOWN_EQUIPMENT.join(', ')}.` },
          notes: { type: 'string', description: 'Concise ingredient list and key steps (under 900 characters), so the cook can follow along.' },
          concurrent: { type: 'boolean', description: 'False only if the dish needs the oven to itself or constant attention (e.g. soufflé, candy at hard-crack).' },
          uncertainFields: { type: 'array', items: { type: 'string', enum: REVIEWABLE }, description: 'Fields you had to guess because the recipe did not state them or the image was unreadable.' },
        },
      },
    },
  },
};

export const AI_SYSTEM = `You read recipes (photos, scans, PDFs, web pages, or pasted text) and convert them into timing data for Kitchen Sync, a scheduler that plans several dishes around shared ovens, burners and one cook's hands.

Split each recipe's time into: prep → wait (hands-off before cooking) → active (hands-on cooking) → passive (unattended oven/simmer/set) → rest. These must not overlap or double count: if a recipe states "Cook time 1 hr" and 10 minutes of that is sautéing before a 50-minute bake, active is 10 and passive is 50. Read the instructions, not just the header times, because header times are often wrong or lumped together. If a time is not stated, estimate it as an experienced cook would and list the field in uncertainFields.

Return one entry per distinct recipe in the input; if the input has several recipes (e.g. a cookbook page), return them all. If there is no recipe at all, return an empty list.`;
