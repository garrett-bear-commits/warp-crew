// @ts-nocheck
/**
 * The contract generator's content (Phase 3 design §3; voices in docs/design/23-world-bible.md). Every daily offer
 * gets a client, a job, a cargo line and, on most risky jobs, a set-piece twist. Briefs are in each client's voice
 * and are filled with {cargo}, {place} and {enemy}. Text rules (test/contract_generator.test.mjs): no digits, each
 * brief at most 110 characters once filled.
 */

/**
 * Who asks. `sectors`: where they post work (null: everywhere). Briefs by profile, each [job, line]: the job sets the
 * card title (JOBS) and any fixed twist, so the title always matches what the client asks for.
 */
export const CLIENTS = Object.freeze({
  vell: {
    sectors: null,
    briefs: {
      reliable: [['deliver', "{place} wants {cargo}. I want my tenth. You want paying. Everybody wins."],
        ['courier', "Simple run to {place}. If it stops being simple, that's a separate invoice."]],
      risky: [['clear', "{enemy} near {place}. Somebody has to be brave, and you're cheaper than brave."],
        ['bounty', "There's a price on a captain near {place}. Collect it. I'll collect my tenth."],
        ['debt', 'Someone at {place} owes the Exchange. Remind them politely. Then less politely.']],
      strange: [['investigate', 'Something odd at {place}. Odd pays. Go and be paid.'],
        ['retrieve', 'A client wants {cargo} back from {place}. The client is vague. The money is not.']],
    },
  },
  fenn: {
    sectors: null,
    briefs: {
      reliable: [['haul', 'Union haul: {cargo} to {place}. On time and intact. Late fees apply, to you mostly.'],
        ['deliver', 'I need {cargo} at {place} tonight. The Union thanks you. The Union also fines you.'],
        ['tow', 'A Union rig broke down near {place} with {cargo} aboard. Tow it home.']],
      risky: [['escort', '{enemy} keep hitting Union boats near {place}. Fly beside this one and look mean.'],
        ['intercept', 'Somebody shot at my driver near {place}. Find them. Explain the Union to them.']],
    },
  },
  ledgers: {
    sectors: ['spur', 'veil'],
    briefs: {
      reliable: [['haul', 'We bought {cargo}, sold it twice, and now it needs to reach {place}.'],
        ['resupply', 'One sister says {place} is safe. The other sister is paying danger money.']],
      strange: [['retrieve', "Fetch {cargo} from {place}. Don't open it. We mean that. Both of us."],
        ['investigate', 'A trader at {place} owes us an answer and some money. Mostly the money.']],
    },
  },
  sato: {
    sectors: ['spur'],
    briefs: {
      reliable: [['resupply', "The clinic needs {cargo}. Don't ask why. I'm asking nicely, and quickly."],
        ['deliver', 'Bring {cargo} by way of {place}. Please arrive in fewer pieces than last time.']],
      risky: [['escort', "Our supply boat runs through {place}, and the {enemy} would rather it didn't. Fly with it."],
        ['intercept', 'A clinic boat went quiet near {place}. Find out why. Bring everyone back.']],
    },
  },
  grudge: {
    sectors: null,
    briefs: {
      reliable: [['tow', 'Tow {cargo} from {place}. Do not scratch it. It is already scratched. Do not add to it.'],
        ['courier', 'Parts run to {place}. I counted them. Count them again when you land.']],
      strange: [['salvage', 'Salvage claim at {place}. I have counted it. Do not let anyone else count it.'],
        ['recover', 'There is {cargo} at {place} worth money. Bring it. Bring all of it. I will know.']],
    },
  },
  bask: {
    sectors: ['spur', 'veil'],
    briefs: {
      reliable: [['ferry', 'A Compact inspector needs a lift to {place}. The manual says routine. The manual is old.'],
        ['courier', "Compact papers for {place}. I'm told to say urgent and important. They are both."]],
      risky: [['clear', '{enemy} sighted near {place}. Regulations say engage. Please engage.'],
        ['hold', 'The {enemy} are breaking six statutes near {place}. Hold the lane until they stop.']],
    },
  },
  ossory: {
    sectors: null,
    briefs: {
      risky: [['debt', 'Someone near {place} owes me. Be charming, Captain. Then be firm.'],
        ['bounty', "A rival of mine flies near {place}. I'd like them retired. Professionally."],
        ['intercept', 'The {enemy} took something of mine near {place}. Return the favour.']],
      strange: [['retrieve', 'There is a crate at {place} with my name on it. Not literally. That would be careless.'],
        ['recover', 'A friend lost {cargo} near {place}. Find it quietly. My friends prefer quiet.']],
    },
  },
  quist: {
    sectors: null,
    briefs: {
      strange: [['investigate', 'Fascinating readings at {place}. Possibly dangerous. Probably dangerous. Fascinating.'],
        ['recover', 'Our probe went quiet near {place}, mid-sentence. I want the rest of the sentence.'],
        ['listen', "Something at {place} is humming in a key that shouldn't exist. Please record it."],
        ['chart', 'Nobody has charted {place} properly. Do it properly. Bring me numbers.']],
    },
  },
  ulama: {
    sectors: ['veil', 'hollow'],
    briefs: {
      reliable: [['deliver', 'We would like {cargo} carried to {place}. We would like it carried kindly.'],
        ['ferry', 'Our elder wishes to see {place} once more. Carry her gently. She bites.']],
      strange: [['listen', 'At {place} the water remembers a song. Fetch the song. Mind the {enemy}.'],
        ['chart', 'We dreamed of you at {place}. In the dream you were paid. Let us make it true.']],
    },
  },
  nobody: {
    sectors: ['veil', 'hollow', 'crown'],
    briefs: {
      risky: [['intercept', "The {enemy} at {place} carry something they don't understand. Take it."],
        ['hold', '{place}. Tonight. Hold it until the {enemy} leave. You will know why afterwards.']],
      strange: [['retrieve', 'Go to {place}. Collect {cargo}. Payment is already in your account.'],
        ['salvage', "Don't read the manifest. Strip the wreck at {place}. Forget the coordinates."]],
    },
  },
  sallow: {
    sectors: ['veil'],
    briefs: {
      reliable: [['resupply', "Veil Haven needs {cargo}. The road through {place} isn't kind. Be kind back."],
        ['ferry', 'A family is stranded at {place}. Bring them home. There will be soup.']],
      risky: [['clear', "The broods are near {place} again. I'd rather they weren't. So would the patients."],
        ['escort', 'Our soup boat goes through {place}. Mind the {enemy}. Mostly the {enemy}.']],
    },
  },
  ash: {
    sectors: ['ember', 'hollow', 'crown'],
    briefs: {
      reliable: [['haul', 'Foundry order: {cargo} to {place}. Hot work, good pay, minor burns.'],
        ['deliver', "Deliver {cargo} to {place} before it cools. It won't explode. Probably."]],
      risky: [['intercept', "The {enemy} hit our ore line near {place}. Hit them back. I'll make you a medal."],
        ['escort', "Fresh plating ships from {place} today. Guard it, and I'll name a rivet after you."]],
    },
  },
});

/** What goes in the hold: a short name for titles and a phrase for briefs (no commas, so it fits any sentence). */
export const CARGO = Object.freeze([
  ['Coolant', 'forty crates of coolant'], ['Reliquary', 'a sealed reliquary'], ['Medical Gel', 'medical gel'],
  ['Seed Vaults', 'three seed vaults'], ['Colony Mail', 'six months of colony mail'], ['Racing Hound', 'a racing hound named Duchess'],
  ['Prototype Drive', 'a prototype drive that hums'], ['Diplomats', "three diplomats who aren't speaking"], ['Ice Cores', 'ice cores older than the lanes'],
  ['Hull Plating', 'spare hull plating'], ['Tidefall Bells', 'a crate of Tidefall bells'], ['Ration Packs', 'two hundred ration packs'],
  ['Coffee', 'the last good coffee in the Spur'], ['Water Filters', 'water filters'], ['Fuel Cells', 'fuel cells'],
  ['Vaccines', 'vaccines on a timer'], ['Ledger', 'a ledger someone wants burned'], ['Statue', 'a statue of a man nobody likes'],
  ['Engine Parts', 'engine parts in a wedding box'], ['Singing Crystal', 'a singing crystal in a lead box'], ['Survey Probes', 'survey probes with opinions'],
  ['Chickens', 'forty very loud chickens'], ['Fertiliser', 'fertiliser nobody asks about'], ['Cheese', 'a wheel of cheese with a bounty on it'],
  ['Guitar', 'a famous guitar'], ['Prisoner', "a prisoner who swears it's a misunderstanding"], ['Sermon Tapes', 'sermon tapes'],
  ['Wedding Cake', 'a three-tier wedding cake'], ['Black Box', 'a black box nobody names'], ['Ore', 'raw ore with a rumour inside'],
  ['Medicine', 'medicine labelled urgent twice'], ['Batteries', 'batteries from a scrapped lighthouse'], ['Painting', 'a very gloomy painting'],
  ['Antennas', 'salvaged antennas'], ['Sealant', 'the good hull sealant'], ['Insulin', 'insulin for a mining crew'],
  ['Glow Seeds', 'seeds that glow when they are sad'], ['Star Charts', 'star charts nobody has checked'], ['Toys', 'a crate of toys'],
  ['Tidefall Tea', 'Tidefall tea that smells like rain'],
].map(([short, long]) => Object.freeze({ short, long })));

/**
 * Jobs by profile: the card title (filled with {short}, {place} or {target}; `alt` when the brief names no cargo) and
 * any twist the job always runs.
 * Risky jobs without a fixed twist roll one: none, rush or two waves.
 */
export const JOBS = Object.freeze({
  reliable: { haul: { title: 'Haul the {short}', alt: 'Haul to {place}' }, deliver: { title: '{short} Delivery', alt: 'Delivery to {place}' },
    ferry: { title: 'Ferry to {place}' }, resupply: { title: 'Resupply {place}' }, courier: { title: 'Courier Run' },
    tow: { title: 'Tow Job: {short}', alt: 'Tow Job at {place}' } },
  risky: { intercept: { title: 'Intercept at {place}' }, clear: { title: 'Clear {place}' }, bounty: { title: 'Bounty: {target}', twist: 'bounty' },
    escort: { title: 'Escort Run', twist: 'escort' }, hold: { title: 'Hold {place}', twist: 'holdout' }, debt: { title: 'Collect a Debt' } },
  strange: { investigate: { title: 'Investigate {place}' }, recover: { title: 'Recover the {short}', alt: 'Recovery at {place}' },
    listen: { title: 'Listen at {place}' }, salvage: { title: 'Salvage at {place}' }, chart: { title: 'Chart {place}' },
    retrieve: { title: 'Retrieve the {short}', alt: 'Retrieval at {place}' } },
});

/** Rolled twists for risky jobs without a fixed one (weights). */
export const ROLLED_TWISTS = Object.freeze([{ id: null, w: 60 }, { id: 'rush', w: 20 }, { id: 'waves', w: 20 }]);

/** The elite's modifier, by faction. */
export const BOUNTY_MODIFIER = Object.freeze({ corsairs: 'veteran', scrappers: 'heavy', swarm: 'heavy', ice: 'armored', shades: 'overclocked', wardens: 'armored', eclipse: 'overclocked' });
