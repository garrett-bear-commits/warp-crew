// @ts-nocheck
/**
 * Authored events (FTL-lite phase 3).
 *
 * TRAVEL_EVENTS open when a jump arrives at a trade, delivery, salvage or story outcome.
 * The rolled outcome is the event's base; results pay a fraction of it (`pay`, 0–1) after
 * the usual site scaling, so no beacon can pay more than it did before events existed.
 *
 * Choice: { id, label, need?: { role } | { captain }, cost?: { fuel } | { credits }, outcomes }
 * Outcome: { w, text, pay?, story?, hull?, injure?, fight?, hire? }
 *   story  — apply the base story beat (same rewards and unlocks as before)
 *   fight  — open an FTL-lite travel fight against the beacon's weakest fight
 *   hire   — this merc joins (the choice's credit cost is the signing fee)
 * `{crew}` in outcome text is the crew member who does it.
 *
 * ROUTE_EVENTS replace the contract "Signal ahead" choice. Each choice is bound to the
 * existing secure or push route action; the card shows the action's real stakes.
 */

export const GATE_NODES = ['veil_gate', 'ember_gate', 'hollow_mouth', 'halo_approach'];

export const TRAVEL_EVENTS = [
  // ── Trade ──────────────────────────────────────────────────────────────
  {
    id: 'short_weight',
    title: 'Short weight',
    kinds: ['trade'],
    text: "The broker's scale reads light by a crate and a half. He smiles like he knows you can count. The dock is busy, and his cousins work security.",
    choices: [
      { id: 'take', label: 'Take his price', outcomes: [
        { w: 100, pay: 0.75, text: 'You sign. He keeps the half crate and the smile.' }] },
      { id: 'call', label: 'Call the scale', need: { role: 'trader' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} reweighs every crate in front of the whole queue. The broker pays in full to make it stop.' }] },
      { id: 'lean', label: 'Lean on the counter', outcomes: [
        { w: 60, pay: 1, text: 'He finds the missing weight in his own pocket.' },
        { w: 40, pay: 0.5, injure: true, text: 'His cousins walk you out. One of yours limps back to the ship.' }] },
    ],
  },
  {
    id: 'hold_inspection',
    title: 'Hold inspection',
    kinds: ['trade', 'delivery'],
    text: "A customs drone flags your hold for irregular mass. The queue behind you is already swearing. The officer's hand is out, palm up.",
    choices: [
      { id: 'fee', label: 'Pay the fee', cost: { credits: 20 }, outcomes: [
        { w: 100, pay: 1, text: 'The drone loses interest. Your cargo clears.' }] },
      { id: 'papers', label: 'Show the papers', need: { role: 'security' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} quotes the regs back at the officer, chapter and line. You clear without a tip.' }] },
      { id: 'wait', label: 'Wait for a real inspection', outcomes: [
        { w: 100, pay: 0.6, text: 'Four hours in the queue. Half your buyers left.' }] },
    ],
  },
  {
    id: 'rival_hauler',
    title: 'Same cargo, same dock',
    kinds: ['trade'],
    text: 'Another crew docked an hour ahead of you with the same cargo. Prices are already sliding. Their captain suggests splitting the market quietly.',
    choices: [
      { id: 'split', label: 'Split the market', outcomes: [
        { w: 100, pay: 0.7, text: 'Half the buyers each. Nobody gets rich. Nobody gets shot.' }] },
      { id: 'undercut', label: 'Undercut them', outcomes: [
        { w: 55, pay: 1, text: 'They blink first and leave for the next ring.' },
        { w: 45, pay: 0.4, text: 'They undercut back. By sundown nobody is making money.' }] },
      { id: 'race', label: 'Beat them to the next buyer', need: { role: 'pilot' }, cost: { fuel: 1 }, outcomes: [
        { w: 100, pay: 1, text: "{crew} has you unloading at the next ring before they've finished their coffee." }] },
    ],
  },
  {
    id: 'stall_fire',
    title: 'Stall fire',
    kinds: ['trade'],
    text: 'A cook-stall goes up two rows from your buyer. Smoke fills the arcade and the crowd breaks for the airlocks. Your buyer is still holding the money.',
    choices: [
      { id: 'help', label: 'Help put it out', outcomes: [
        { w: 100, pay: 0.8, text: 'Soot to the elbows. The stallholders pay what they can and remember your face.' }] },
      { id: 'seal', label: 'Seal the vent', need: { role: 'engineer' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} chokes the fire at the vent. Your buyer pays in full and throws in a meal.' }] },
      { id: 'sell', label: 'Sell into the panic', outcomes: [
        { w: 70, pay: 1, text: 'Panic buyers pay full price. You try not to feel good about it.' },
        { w: 30, pay: 0.6, injure: true, text: 'The crowd tramples the stall and one of your crew with it.' }] },
    ],
  },
  {
    id: 'masked_buyer',
    title: 'Masked buyer',
    kinds: ['trade'],
    sectors: ['veil', 'hollow', 'crown'],
    text: "A buyer in a porcelain mask offers more than the board rate, in a currency you don't recognise. The hatch they trade through has no name on it. Nobody here asks questions, and neither does the mask.",
    choices: [
      { id: 'board', label: 'Sell at the board rate', outcomes: [
        { w: 100, pay: 0.8, text: 'Clean credits, posted price, no mask.' }] },
      { id: 'check', label: 'Check the currency first', need: { role: 'scout' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} traces the coin to a real bank three jumps out. Deal.' }] },
      { id: 'mask', label: "Take the mask's offer", outcomes: [
        { w: 60, pay: 1, text: 'The coin is good. The mask bows and is gone.' },
        { w: 40, fight: true, text: 'The coin was a tracker. Company is already on its way.' }] },
    ],
  },
  {
    id: 'ring_tithe',
    title: 'Ring tithe',
    kinds: ['trade', 'delivery'],
    sectors: ['crown'],
    text: "Crown customs takes a tithe on every sale in the ring: a share for the Throne, a share for the clerk, a share for the clerk's lunch. Warden skiffs sit on the approach to make sure everyone pays.",
    choices: [
      { id: 'pay', label: 'Pay the tithe', outcomes: [
        { w: 100, pay: 0.7, text: 'The clerk stamps your ledger in gold ink. It is the most expensive ink in the galaxy.' }] },
      { id: 'outside', label: 'Sell outside the ring', need: { role: 'trader' }, cost: { fuel: 1 }, outcomes: [
        { w: 100, pay: 1, text: '{crew} knows a buyer parked just past the customs line.' }] },
      { id: 'skip', label: 'Skip the tithe', outcomes: [
        { w: 50, pay: 1, text: 'Nobody notices. This time.' },
        { w: 50, pay: 0.3, hull: 6, text: 'Warden flak scorches the hull. The clerk fines you most of what is left.' }] },
    ],
  },
  // ── Delivery ───────────────────────────────────────────────────────────
  {
    id: 'warm_cargo',
    title: 'Warm cargo',
    kinds: ['delivery'],
    text: 'The medicine crates in your hold are warming. The cold-chain seal cracked somewhere back down the lane, and this consignee pays by the degree.',
    choices: [
      { id: 'as_is', label: 'Deliver it as is', outcomes: [
        { w: 100, pay: 0.6, text: 'The consignee reads the thermometer twice and pays for what survived.' }] },
      { id: 'rewire', label: 'Rewire the cooler', need: { role: 'engineer' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} bypasses the seal with a coil from the galley. Crates arrive cold.' }] },
      { id: 'burn', label: 'Burn hard for the dock', cost: { fuel: 1 }, outcomes: [
        { w: 100, pay: 1, text: 'You redline the drive. The crates arrive cold and so does the crew.' }] },
    ],
  },
  {
    id: 'late_consignee',
    title: 'Late consignee',
    kinds: ['delivery'],
    text: 'Your consignee is three hours late and the dock master wants your berth. Something without a transponder is sitting just off the beacon.',
    choices: [
      { id: 'wait', label: 'Wait at the beacon', outcomes: [
        { w: 70, pay: 1, text: 'The consignee arrives, apologises, pays.' },
        { w: 30, fight: true, text: 'The thing without a transponder had guns.' }] },
      { id: 'shadow', label: 'Hold station in the shadow', need: { role: 'pilot' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} parks you in the station shadow. Nothing out there sees you. The consignee does.' }] },
      { id: 'drop', label: 'Leave it with the dock master', outcomes: [
        { w: 100, pay: 0.5, text: 'He signs for it. He takes his cut.' }] },
    ],
  },
  {
    id: 'stowaway',
    title: 'Stowaway',
    kinds: ['delivery'],
    sectors: ['spur'],
    text: 'Juno Kett climbs out of a crate of survey drones, shaking vent dust out of her hair. She says she walked Dust Lane on foot and can walk your crawlspaces too. She would like a berth. She would like a sandwich first.',
    choices: [
      { id: 'sign', label: 'Sign her on', cost: { credits: 120 }, outcomes: [
        { w: 100, pay: 1, hire: 'merc_juno', text: 'Juno takes the sandwich and the bunk nearest the vents.' }] },
      { id: 'drop', label: 'Drop her at the dock', outcomes: [
        { w: 100, pay: 1, text: 'She salutes, steals a ration bar and vanishes into the crowd.' }] },
    ],
  },
  {
    id: 'extra_passengers',
    title: 'Extra passengers',
    kinds: ['delivery'],
    sectors: ['spur', 'veil'],
    text: 'The colony pallets come with six families who missed the last transport. The dock master shrugs. Your life support is rated for your crew, not theirs.',
    choices: [
      { id: 'take', label: 'Take them', outcomes: [
        { w: 75, pay: 1, text: 'Six families, one recycler, a long night. They tip in chits the dock takes at par.' },
        { w: 25, pay: 1, injure: true, text: 'A fever goes round the hold. One of your crew catches it.' }] },
      { id: 'medic', label: 'Take them, medic on watch', need: { role: 'medic' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} runs the hold like a clinic. Everyone walks off the ramp.' }] },
      { id: 'cargo', label: 'Cargo only', outcomes: [
        { w: 100, pay: 0.9, text: "You leave them on the dock. The client's bonus leaves with them." }] },
    ],
  },
  {
    id: 'convoy_forming',
    title: 'Convoy forming',
    kinds: ['delivery'],
    sectors: ['spur', 'veil', 'ember'],
    text: "A slow convoy is forming at the beacon. Join it and you're safe, but you'll arrive with everyone else's cargo and everyone else's prices.",
    choices: [
      { id: 'join', label: 'Join the convoy', outcomes: [
        { w: 100, pay: 0.75, text: 'Safe, slow, crowded market. You get paid. Eventually.' }] },
      { id: 'escort', label: 'Ride as escort', need: { role: 'gunner' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} takes the flank. The convoy pays escorts first.' }] },
      { id: 'solo', label: 'Run it alone', outcomes: [
        { w: 65, pay: 1, text: 'Empty lane, full price.' },
        { w: 35, fight: true, text: 'Raiders like a ship that travels alone.' }] },
    ],
  },
  {
    id: 'ion_front',
    title: 'Ion front',
    kinds: ['delivery', 'trade'],
    sectors: ['ember', 'hollow'],
    text: "An ion front rolls across the lane. Instruments ghost and the comms fill with your own voice. The buyer won't wait past the storm.",
    choices: [
      { id: 'edge', label: 'Ride it out at the edge', outcomes: [
        { w: 100, pay: 0.6, text: 'You arrive after the storm and after the good prices.' }] },
      { id: 'thread', label: 'Thread the calm cells', need: { role: 'pilot' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} flies the gaps between lightning like a back road home.' }] },
      { id: 'punch', label: 'Punch straight through', outcomes: [
        { w: 60, pay: 1, text: 'Sparks on every panel. You make the buyer on time.' },
        { w: 40, pay: 0.7, hull: 10, text: 'A discharge cooks a hull section. You make it, late and smoking.' }] },
    ],
  },
  // ── Salvage ────────────────────────────────────────────────────────────
  {
    id: 'hot_reactor',
    title: 'Hot reactor',
    kinds: ['salvage'],
    text: "The wreck's reactor is still warm. The good parts are bolted around it. Your counter clicks like a cheap watch.",
    choices: [
      { id: 'fast', label: 'Cut fast and get out', outcomes: [
        { w: 65, pay: 1, text: 'In, out, hands steady. Full hold.' },
        { w: 35, pay: 0.6, hull: 8, text: 'A coolant line bursts across your bow. You leave with what you carried.' }] },
      { id: 'safe', label: 'Safe the reactor first', need: { role: 'engineer' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} scrams the core and you strip the wreck at leisure.' }] },
      { id: 'plates', label: 'Take the hull plates only', outcomes: [
        { w: 100, pay: 0.5, text: 'Plates are plates. Nobody glows.' }] },
    ],
  },
  {
    id: 'welded_hatch',
    title: 'Welded hatch',
    kinds: ['salvage'],
    text: 'Someone welded this hatch shut from the inside. The welds are old. The scratches on the other side are not.',
    choices: [
      { id: 'force', label: 'Force it', outcomes: [
        { w: 70, pay: 1, text: 'Empty. Whatever scratched left a long time ago. The cargo did not.' },
        { w: 30, pay: 0.7, injure: true, text: 'Something was waiting. Your crew wins, barely.' }] },
      { id: 'breach', label: 'Breach it by the book', need: { role: 'security' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} breaches, clears, calls it. Nothing in there but cargo.' }] },
      { id: 'outer', label: 'Strip the outer hull and go', outcomes: [
        { w: 100, pay: 0.45, text: 'You leave the hatch closed. Some doors are fine closed.' }] },
    ],
  },
  {
    id: 'claim_jumpers',
    title: 'Claim jumpers',
    kinds: ['salvage'],
    text: 'Another crew is already cutting the wreck. Their skiff is small and their guns are not. They hail you: half and half, nobody bleeds.',
    choices: [
      { id: 'split', label: 'Split it', outcomes: [
        { w: 100, pay: 0.55, text: 'Half a wreck. Nobody bleeds.' }] },
      { id: 'warn', label: 'Warning shot', need: { role: 'gunner' }, outcomes: [
        { w: 75, pay: 1, text: "{crew} parks one across their bow. They decide it's your wreck." },
        { w: 25, fight: true, text: 'They answer the warning with one of their own.' }] },
      { id: 'take', label: 'Take all of it', outcomes: [
        { w: 100, fight: true, text: "They don't share, and neither do you." }] },
    ],
  },
  {
    id: 'flight_recorder',
    title: 'Flight recorder',
    kinds: ['salvage'],
    text: "The wreck's recorder is still pinging, begging for someone to listen. Strip the wreck now and you'll never know what it's saying.",
    choices: [
      { id: 'strip', label: 'Strip the wreck', outcomes: [
        { w: 100, pay: 0.8, text: 'You work around the noise. Most of the good stuff comes out.' }] },
      { id: 'play', label: 'Play the recorder', need: { role: 'scout' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} pulls the last log. It names the vault. You go straight there.' }] },
      { id: 'listen', label: 'Listen anyway', outcomes: [
        { w: 50, pay: 1, text: 'The captain hid the good cargo. The recorder tells you where.' },
        { w: 50, pay: 0.6, text: 'Forty minutes of a man singing to his kids. You lose the light.' }] },
    ],
  },
  {
    id: 'escape_pod',
    title: 'Escape pod',
    kinds: ['salvage'],
    sectors: ['spur', 'veil'],
    text: 'A pod tumbles out of the debris with one heartbeat on the sensor. Inside: a yard droid with four arms, two of them waving. It says its name is NUB-4 and it would like to not be scrap.',
    choices: [
      { id: 'sign', label: 'Take NUB-4 aboard', cost: { credits: 110 }, outcomes: [
        { w: 100, pay: 0.7, hire: 'merc_nub', text: 'You pay off its yard debt. NUB-4 starts arguing with your torque specs at once.' }] },
      { id: 'tow', label: 'Tow the pod to the beacon', outcomes: [
        { w: 100, pay: 0.9, text: 'You leave it blinking at the beacon and get back to cutting.' }] },
    ],
  },
  {
    id: 'mined_debris',
    title: 'Mined debris',
    kinds: ['salvage'],
    text: 'The debris field is seeded with old proximity mines. Most of them are dead. Most.',
    choices: [
      { id: 'thread', label: 'Thread the field', need: { role: 'pilot' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} counts the dead ones out loud and flies between the live ones.' }] },
      { id: 'creep', label: 'Creep in on thrusters', cost: { fuel: 1 }, outcomes: [
        { w: 100, pay: 1, text: 'Slow, expensive, nothing goes bang.' }] },
      { id: 'straight', label: 'Go straight in', outcomes: [
        { w: 55, pay: 1, text: 'Dead. All of them. This time.' },
        { w: 45, pay: 0.7, hull: 12, text: 'One was not dead.' }] },
    ],
  },
  {
    id: 'swarm_husk',
    title: 'Swarm husk',
    kinds: ['salvage'],
    sectors: ['veil', 'ember', 'hollow', 'crown'],
    text: 'A dead Swarm drone the size of a freighter drifts in the field. Its plating is worth a fortune. Its nerve-mesh still twitches when your lights touch it.',
    choices: [
      { id: 'cut', label: 'Cut the plating', outcomes: [
        { w: 60, pay: 1, text: 'The mesh twitches. It does nothing else. You fill the hold.' },
        { w: 40, fight: true, text: 'The mesh calls home. Something answers.' }] },
      { id: 'kill', label: 'Kill the mesh first', need: { role: 'engineer' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} shorts the mesh with a jump lead. The husk goes properly dead.' }] },
      { id: 'scraps', label: 'Take the loose scraps', outcomes: [
        { w: 100, pay: 0.5, text: 'You leave the big thing sleeping.' }] },
    ],
  },
  {
    id: 'fused_hulls',
    title: 'Fused hulls',
    kinds: ['salvage'],
    sectors: ['hollow', 'crown'],
    text: 'Two wrecks are fused at the airlock, their crews still aboard in suits. The salvage is good. Your crew has gone quiet.',
    choices: [
      { id: 'strip', label: 'Strip both hulls', outcomes: [
        { w: 75, pay: 1, text: 'You work fast and nobody talks.' },
        { w: 25, pay: 1, injure: true, text: 'Someone takes it hard. They need time off.' }] },
      { id: 'tag', label: 'Tag the dead, then strip', need: { role: 'medic' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} logs every name for the families first. The work goes easier after.' }] },
      { id: 'loose', label: 'Take only what floats free', outcomes: [
        { w: 100, pay: 0.6, text: 'You leave the airlock sealed.' }] },
    ],
  },
  {
    id: 'tow_hook',
    title: 'Tow hook',
    kinds: ['salvage'],
    sectors: ['spur', 'veil', 'ember'],
    text: "A hauler with a dead drive offers you salvage rights if you tow them to the beacon. Tow cables cost fuel. Their cargo is sitting right there.",
    choices: [
      { id: 'tow', label: 'Tow them in', cost: { fuel: 1 }, outcomes: [
        { w: 100, pay: 1, text: 'They wave you through to the good wreck.' }] },
      { id: 'patch', label: 'Patch their drive', need: { role: 'engineer' }, outcomes: [
        { w: 100, pay: 1, text: '{crew} has their drive coughing in ten minutes. They hand over the salvage rights gladly.' }] },
      { id: 'cut', label: 'Cut the wreck yourself', outcomes: [
        { w: 70, pay: 0.8, text: 'They swear at you all the way. You fill the hold anyway.' },
        { w: 30, fight: true, text: 'Their friends arrive, and they are not friendly.' }] },
    ],
  },
  // ── Story ──────────────────────────────────────────────────────────────
  {
    id: 'dead_band',
    title: 'Dead band',
    kinds: ['story'],
    notNodes: GATE_NODES,
    text: "A voice is repeating coordinates on a band nobody has used since the war. The coordinates are close. The voice doesn't breathe.",
    choices: [
      { id: 'follow', label: 'Follow it in', outcomes: [
        { w: 80, story: true, text: 'You find where the voice comes from.' },
        { w: 20, story: true, hull: 6, text: 'You find where the voice comes from. Something there finds your hull.' }] },
      { id: 'triangulate', label: 'Triangulate from range', need: { role: 'scout' }, outcomes: [
        { w: 100, story: true, text: '{crew} pins the source from a safe distance.' }] },
      { id: 'sell', label: 'Sell the coordinates', outcomes: [
        { w: 100, pay: 0.5, text: 'A collector pays for the numbers. Whatever is out there stays a rumour for now.' }] },
    ],
  },
  {
    id: 'owed_drink',
    title: 'Someone who knows you',
    kinds: ['story'],
    notNodes: GATE_NODES,
    text: "A woman hails you by name and swears you owe her a drink. You've never met. She says she has something worth hearing, and that the drink is not negotiable.",
    choices: [
      { id: 'drink', label: 'Buy the drink', cost: { credits: 10 }, outcomes: [
        { w: 100, story: true, text: 'Two drinks, actually. She talks.' }] },
      { id: 'read', label: 'Read her', need: { captain: 'captain_alien' }, outcomes: [
        { w: 100, story: true, text: 'You read the lie in her and the truth under it. She talks for free.' }] },
      { id: 'hear', label: 'Hear her out, no drink', outcomes: [
        { w: 70, story: true, text: 'She grumbles and talks anyway.' },
        { w: 30, pay: 0.3, text: 'She leaves. She meant it about the drink. She leaves a datachip behind out of spite.' }] },
    ],
  },
  {
    id: 'colony_call',
    title: 'Colony call',
    kinds: ['story'],
    nodes: ['colony_hope', 'hope_orbit', 'veil_haven_dock', 'frost_harbor'],
    text: "The colony's comms officer is nineteen and trying hard not to sound scared. Swarm scouts have circled the dome for a week. They can't pay much. They can pay in what they've seen.",
    choices: [
      { id: 'picket', label: 'Fly a picket', outcomes: [
        { w: 70, story: true, text: 'The scouts peel off when they see a real ship.' },
        { w: 30, story: true, hull: 8, text: 'One scout tests you before it peels off.' }] },
      { id: 'guns', label: 'Fly the picket guns hot', need: { role: 'gunner' }, outcomes: [
        { w: 100, story: true, text: "{crew} tags the nearest scout. The rest decide the dome isn't worth it." }] },
      { id: 'rations', label: 'Drop rations and go', outcomes: [
        { w: 100, pay: 0.3, text: 'They give you a chip of sensor logs for the rations. It is worth a little.' }] },
    ],
  },
  {
    id: 'foundry_voice',
    title: 'Foundry voice',
    kinds: ['story'],
    nodes: ['forge_moon', 'solar_forge', 'twin_suns', 'ember_lane'],
    text: "The foundry's AI still thinks the war is on. It wants your requisition code before it opens the yard. You don't have one. You have a ship that looks military if you squint.",
    choices: [
      { id: 'machine', label: 'Talk to it machine to machine', need: { captain: 'captain_droid' }, outcomes: [
        { w: 100, story: true, text: 'You speak its protocol. It salutes, in its way.' }] },
      { id: 'bluff', label: 'Bluff a requisition', outcomes: [
        { w: 65, story: true, text: 'It accepts your code. Your code was a grocery list.' },
        { w: 35, fight: true, text: 'It checks the code. The yard defences wake up.' }] },
      { id: 'note', label: 'Leave a polite note', outcomes: [
        { w: 100, pay: 0.4, text: 'The yard boss finds it next shift and sends a few spare parts your way.' }] },
    ],
  },
  {
    id: 'brokers_price',
    title: "Broker's price",
    kinds: ['story'],
    nodes: ['black_canal', 'widow_reef', 'null_harbor', 'silent_choir', 'echo_tomb', 'throne_dock', 'pirate_nest'],
    text: "A broker in a dark booth knows something about the Swarm lanes. She'll sell it for credits, or for a favour she won't describe.",
    choices: [
      { id: 'pay', label: 'Pay her', cost: { credits: 30 }, outcomes: [
        { w: 100, story: true, text: 'She talks. It was worth it.' }] },
      { id: 'haggle', label: 'Haggle for it', need: { role: 'trader' }, outcomes: [
        { w: 100, story: true, text: '{crew} talks her down to a handshake and a rumour of their own.' }] },
      { id: 'favour', label: 'Owe her a favour', outcomes: [
        { w: 75, story: true, text: 'She talks. The favour can wait.' },
        { w: 25, story: true, fight: true, text: 'She talks. Then the favour comes due, with guns.' }] },
    ],
  },
  {
    id: 'hull_song',
    title: 'Song in the hull',
    kinds: ['story'],
    notNodes: GATE_NODES,
    sectors: ['veil', 'ember', 'hollow', 'crown'],
    text: "Your hull plates start humming three notes, the same three the Swarm drones sing before they move. Your crew wants to know if you're going to stop it.",
    choices: [
      { id: 'play', label: 'Let it play out', outcomes: [
        { w: 70, story: true, text: 'The song finishes. It meant something.' },
        { w: 30, story: true, injure: true, text: "The song finishes. One of your crew doesn't sleep for a day." }] },
      { id: 'decode', label: 'Record and decode it', need: { role: 'scout' }, outcomes: [
        { w: 100, story: true, text: '{crew} slows the recording down until it is words.' }] },
      { id: 'kill', label: 'Kill power to the plates', outcomes: [
        { w: 100, pay: 0.3, text: 'Silence. You sell the recording you made before it stopped.' }] },
    ],
  },
  {
    id: 'gate_customs',
    title: 'Gate customs',
    kinds: ['story'],
    nodes: GATE_NODES,
    text: "The customs line is forty ships long and moves one ship an hour. The clerks are polite, slow and armed. Your papers are mostly real.",
    choices: [
      { id: 'wait', label: 'Wait your turn', outcomes: [
        { w: 80, story: true, text: 'Six hours. A stamp. You are through.' },
        { w: 20, story: true, injure: true, text: 'Customs searches one of your crew. Thoroughly. You are through.' }] },
      { id: 'papers', label: 'Flash the right papers', need: { role: 'security' }, outcomes: [
        { w: 100, story: true, text: '{crew} knows which clerk to show which page. Straight through.' }] },
      { id: 'sell', label: 'Sell your place in line', outcomes: [
        { w: 100, pay: 0.5, text: 'A hauler in a hurry pays well for your spot. The gate will be here tomorrow.' }] },
    ],
  },
  {
    id: 'gate_toll',
    title: 'Gate toll',
    kinds: ['story'],
    nodes: GATE_NODES,
    text: "Someone has parked a gunship across the gate approach and is charging a toll they call a lane maintenance fee. Real customs is on the far side, pretending not to see.",
    choices: [
      { id: 'pay', label: 'Pay the toll', cost: { credits: 25 }, outcomes: [
        { w: 100, story: true, text: 'They wave you through with a little salute.' }] },
      { id: 'warn', label: 'Answer with a warning shot', need: { role: 'gunner' }, outcomes: [
        { w: 100, story: true, text: '{crew} puts a shot close enough to read their hull number. The toll is waived.' }] },
      { id: 'run', label: 'Run the gate', outcomes: [
        { w: 60, story: true, text: 'You are through before they spin up.' },
        { w: 40, story: true, fight: true, text: 'You make the gate. They follow you through it.' }] },
    ],
  },
];

export const ROUTE_EVENTS = [
  {
    id: 'weigh_station',
    title: 'Weigh station',
    profiles: ['reliable'],
    text: 'A weigh station hails your contract run: random inspection, mandatory. The inspector has a bored voice and a long queue. A side lane skips the station, and its cameras.',
    choices: [
      { id: 'inspect', route: 'secure', label: 'Take the inspection' },
      { id: 'side', route: 'push', label: 'Take the side lane' },
    ],
  },
  {
    id: 'moved_buoy',
    title: 'Moved buoy',
    profiles: ['reliable', 'strange'],
    text: "A nav buoy sits two klicks off its charted spot, still blinking all clear. Someone moved it. The gap it left points at something on long-range.",
    choices: [
      { id: 'chart', route: 'secure', label: 'Fly the charted lane' },
      { id: 'gap', route: 'push', label: 'Look at what it was hiding' },
    ],
  },
  {
    id: 'mayday_echo',
    title: 'Mayday echo',
    profiles: ['reliable', 'risky'],
    text: 'A mayday repeats on the contract band, recorded, not live. The ship that sent it is still out there, or what is left of it. So is whoever left it that way.',
    choices: [
      { id: 'deliver', route: 'secure', label: 'Stick to the job' },
      { id: 'answer', route: 'push', label: 'Answer the mayday' },
    ],
  },
  {
    id: 'two_contacts',
    title: 'Two contacts',
    profiles: ['risky'],
    text: 'Long-range shows two contacts holding station near the drop. One is small and nervous. One is large and not moving at all. The client said "some trouble" and smiled.',
    choices: [
      { id: 'small', route: 'secure', label: 'Engage the small one' },
      { id: 'large', route: 'push', label: 'Go for the big one' },
    ],
  },
  {
    id: 'bait_freighter',
    title: 'Bait in the lane',
    profiles: ['risky'],
    text: 'A freighter sits dead in the lane with its hatches open and its beacon screaming. Nobody abandons cargo like that. Somebody wants you to stop.',
    choices: [
      { id: 'terms', route: 'secure', label: 'Spring it on your terms' },
      { id: 'hunt', route: 'push', label: 'Hunt whoever set it' },
    ],
  },
  {
    id: 'static_song',
    title: 'Song in the static',
    profiles: ['strange'],
    text: "The contract signal resolves into music: three notes, over and over. Your scanner says it's coming from the cargo you were hired to collect.",
    choices: [
      { id: 'grab', route: 'secure', label: 'Grab the cargo and go' },
      { id: 'follow', route: 'push', label: 'Follow the song' },
    ],
  },
  {
    id: 'ghost_manifest',
    title: 'Ghost manifest',
    profiles: ['strange'],
    text: "The manifest lists a crate that doesn't exist and a crew member who died ten years ago. The client's stamp is real. So is a second ping from deeper in.",
    choices: [
      { id: 'stamp', route: 'secure', label: 'Deliver what the stamp says' },
      { id: 'ping', route: 'push', label: 'Chase the second ping' },
    ],
  },
  {
    id: 'detour_beacon',
    title: 'Detour beacon',
    profiles: ['reliable', 'risky', 'strange'],
    text: 'A beacon warns of a debris slide on the direct route and points you down an older lane. The older lane is quiet. Too quiet, your pilot says, because pilots are like that.',
    choices: [
      { id: 'direct', route: 'secure', label: 'Take the direct route anyway' },
      { id: 'old', route: 'push', label: 'Take the old lane' },
    ],
  },
];

export const TRAVEL_EVENT_BY_ID = Object.fromEntries(TRAVEL_EVENTS.map(event => [event.id, event]));
export const ROUTE_EVENT_BY_ID = Object.fromEntries(ROUTE_EVENTS.map(event => [event.id, event]));
