// @ts-nocheck
/**
 * The main campaign, "The Long Jump" (Phase 3, docs/superpowers/specs/2026-10-10-world-design.md §2; canon and
 * voice in docs/design/23-world-bible.md). A chapter is five story missions and a boss, which is that sector's
 * Siege wall. Story missions are contracts with a briefing and a debrief transmission, a set-piece twist and an
 * authored bonus on top of the fight's pay. Rules live in src/systems/campaign.js.
 *
 * Text rules (test/campaign.test.mjs): at most 30 words a panel and 4 panels a transmission, known speakers,
 * numbers in words. Tokens: {ship}, {captain}, {hullid}, {hullidrev} (src/data/speakers.js fillStoryText).
 */

export const TRANSMISSIONS = Object.freeze({
  // --- Chapter 1: Cheap Ship, Bad History (the Spur) -------------------------------------------------------
  c1_open: {
    kicker: 'Chapter 1', title: 'Cheap Ship, Bad History', art: 'art/pixel/cinematic/v2/chapter-spur.png',
    panels: [
      { speaker: 'vell', text: "So you're the one who bought the Sparrow. Brave. Or you didn't read her history." },
      { speaker: 'vell', text: "I'm Vell. I run the Exchange. Every job in the Spur crosses my desk, and a tenth of every job stays on it." },
    ],
  },
  c1m1_brief: {
    panels: [
      { speaker: 'vell', text: "Hope's Rest needs medical gel, and pirates sniff around that lane. Bring it in warm and I'll know you're real." },
      { speaker: 'vell', text: 'Small job, small pay. Everybody starts somewhere. Most people start somewhere with fewer bullet holes.' },
    ],
  },
  c1m1_debrief: {
    panels: [
      { speaker: 'sato', text: "The gel's intact. You have no idea how rare that sentence is out here. Thank you, {ship}." },
      { speaker: 'vell', text: 'Clean work. Wren Halloway flew that lane too, before she vanished mid-jump. Her black box is still in your walls.' },
      { speaker: 'blackbox', text: "...log, day one. Cheap ship, bad history. I'm going to make her a legend..." },
      { speaker: 'captain', text: "That's my voice. Why is that my voice?" },
    ],
  },
  c1m2_brief: {
    panels: [
      { speaker: 'fenn', text: "Moro Fenn, Haulers' Union. Big Mabel is the oldest freighter on the Spine. She hauls grain, and she hauls it slow." },
      { speaker: 'fenn', text: 'Corsairs have hit her twice this month. Fly beside her down Dust Lane. If she loses her hull, you lose part of your fee.' },
      { speaker: 'vell', text: 'He means it. Moro once fined his own mother.' },
    ],
  },
  c1m2_debrief: {
    panels: [
      { speaker: 'fenn', text: "Mabel made it. She's flashing her running lights at you. That's freighter for thank you. Or for move." },
      { speaker: 'fenn', text: 'Those raiders flew the Corsair King\'s colours. He taxes every ship through the Veil Gate now. Nobody pays him gladly.' },
    ],
  },
  c1m3_brief: {
    panels: [
      { speaker: 'vell', text: 'Bounty on a corsair ace: Two-Tooth Marrik. He shot up a clinic boat for fun. The Exchange would like him to stop.' },
      { speaker: 'crane', text: "Silas Crane, the Gilded Hound. Marrik is my bounty, little Sparrow. Go home. I'll send you a postcard." },
      { speaker: 'vell', text: 'Crane takes every bounty in the Spur. Every single one. Annoy him for me?' },
    ],
  },
  c1m3_debrief: {
    panels: [
      { speaker: 'crane', text: "You took Marrik. In that ship. I'm not impressed, Captain. I'm alarmed." },
      { speaker: 'crane', text: 'Free advice: Marrik was paid to slow ships down at the Gate. Ask yourself who wants the Gate slow.' },
      { speaker: 'vell', text: "He's sulking. Best thing I've seen all week." },
    ],
  },
  c1m4_brief: {
    panels: [
      { speaker: 'sato', text: 'Swarm probes tagged our colony. Tagged means marked. Marked means the broods come.' },
      { speaker: 'sato', text: 'Our radios play static that sounds like singing. The children hum along. I would like that to stop.' },
      { speaker: 'vell', text: 'The Swarm comes in waves. Kill the first and stay put. The second is the one that bites.' },
    ],
  },
  c1m4_debrief: {
    panels: [
      { speaker: 'sato', text: 'The static stopped. The children are annoyed. Everyone else is crying, in the good way.' },
      { speaker: 'choir', text: '...{hullidrev}... {hullidrev}... we hear you. little loud thing.' },
      { speaker: 'captain', text: 'Did that signal just read our hull ID backwards?' },
      { speaker: 'sato', text: 'It does that. Please never answer it.' },
    ],
  },
  c1m5_brief: {
    panels: [
      { speaker: 'tarrow', text: "Commodore Ines Tarrow, Compact Navy. What's left of it. I hold the gates of the Spur with one frigate." },
      { speaker: 'tarrow', text: "The Corsair King sits on the Veil Gate and taxes everyone through. I can't move him. Perhaps you can." },
      { speaker: 'tarrow', text: "First, show me you can hold. A refugee convoy runs the Glass Spur tonight. Keep the King's raiders busy until it's clear." },
    ],
  },
  c1m5_debrief: {
    panels: [
      { speaker: 'tarrow', text: 'You held. Most captains run. The smart ones run faster.' },
      { speaker: 'tarrow', text: "The King's flagship is at the Corsair Nest. Break him and I'll open the Veil Gate for you. Fail, and we never spoke." },
      { speaker: 'vell', text: "That's Tarrow for 'I like you'. Don't make it weird." },
    ],
  },
  c1_boss_intro: {
    kicker: 'Chapter 1 finale', title: 'The Corsair King',
    panels: [
      { speaker: 'tarrow', text: 'His flagship carries more hull than one fight can break. Every pass you make stays broken until midnight. Keep coming back.' },
      { speaker: 'corsair_king', text: "A Sparrow. Wren's Sparrow. She owed me money too, and look where she is now." },
    ],
  },
  c1_boss_fall: {
    kicker: 'Chapter 1 complete', title: 'The Gate Opens',
    panels: [
      { speaker: 'corsair_king', text: 'Fine! Fine. Take the Gate. Take the toll. Take my good hat.' },
      { speaker: 'tarrow', text: "The Veil Gate is open, and the {ship} is cleared for Compact space. Try to stay that way." },
      { speaker: 'tarrow', text: "The King kept a ledger of Gate bribes. A customs pilot lost her wings over it. She's been waiting at your dock." },
      { speaker: 'merc_kal', text: 'Kal Vesper. They said I took the bribes. The ledger says otherwise. I would like to fly for whoever found it.' },
    ],
  },

  // --- Chapter 2: The Veil -------------------------------------------------------------------------------
  c2_open: {
    kicker: 'Chapter 2', title: 'The Veil', art: 'art/pixel/cinematic/v2/chapter-veil.png',
    panels: [
      { speaker: 'tarrow', text: 'Welcome to the Veil. Ships out here go missing and come back wrong. We call those wraiths.' },
      { speaker: 'merc_kal', text: 'I flew customs out here. Rule one: if you can\'t see it, it can see you.' },
    ],
  },
  c2m1_brief: {
    panels: [
      { speaker: 'tarrow', text: 'A wraith has been shadowing my supply runs through the Veil Garden. It cloaks.' },
      { speaker: 'tarrow', text: "When it fades, hold your fire. When it's solid, hit its helm. Break the helm and it can't hide." },
    ],
  },
  c2m1_debrief: {
    panels: [
      { speaker: 'tarrow', text: 'Wraith down. Its hull was a Compact courier, lost forty years ago. The paint was fresh.' },
      { speaker: 'merc_kal', text: 'Commodore. The paint was fresh.' },
      { speaker: 'tarrow', text: 'I heard you, Vesper.' },
      { speaker: 'stowaway', text: 'hee.' },
    ],
  },
  c2m2_brief: {
    panels: [
      { speaker: 'sallow', text: 'Mother Sallow, Veil Haven. Ours is the last open clinic in the Veil, and the broods are close enough to smell.' },
      { speaker: 'sallow', text: 'Our hospital ship, the Kindness, has two hundred patients and one engine. Please walk her to the Gate.' },
      { speaker: 'sallow', text: "She can't take many hits. Neither can they." },
    ],
  },
  c2m2_debrief: {
    panels: [
      { speaker: 'sallow', text: 'The Kindness is through. Two hundred and two patients. Two were born on the way.' },
      { speaker: 'sallow', text: 'Haven pays in prayers and soup. The soup is very good.' },
      { speaker: 'captain', text: 'Did anyone else hear giggling in the vents?' },
    ],
  },
  c2m3_brief: {
    panels: [
      { speaker: 'blackbox', text: "...if you bought my ship, you found this log. I left a buoy at Echo Reef. Don't let the Swarm sing to it..." },
      { speaker: 'captain', text: 'Same voice. My voice. Saying things I never said.' },
      { speaker: 'merc_kal', text: "A brood is heading for the Reef. If we're going, we go fast." },
    ],
  },
  c2m3_debrief: {
    panels: [
      { speaker: 'blackbox', text: "...the lanes aren't roads. They're roots. Something grew them, and the Swarm is how it keeps them clean..." },
      { speaker: 'blackbox', text: "...I'm going past the Ember gate. If I don't come back, it's because I did..." },
      { speaker: 'captain', text: "That's not a log. That's a dare." },
    ],
  },
  c2m4_brief: {
    panels: [
      { speaker: 'crane', text: "Little Sparrow. I'm pinned at Night Well with a brood on my tail and a bounty in my hold. Help me and I'll owe you." },
      { speaker: 'crane', text: 'I hate owing people. Do this quickly so I can stop.' },
      { speaker: 'vell', text: 'Silas Crane, asking for help. Somebody write down the date.' },
    ],
  },
  c2m4_debrief: {
    panels: [
      { speaker: 'crane', text: "We're square. Nearly. Fine: I owe you one." },
      { speaker: 'crane', text: "My bounty carried Wren Halloway's last route. It ends at the Swarm Scar. Something big nests there." },
      { speaker: 'crane', text: 'Big, and familiar. Ask your Commodore what she lost in the Hush.' },
    ],
  },
  c2m5_brief: {
    panels: [
      { speaker: 'choir', text: '{hullidrev}. {hullidrev}. little loud thing. you jump and jump. we taste every jump.' },
      { speaker: 'choir', text: 'come to the hush yard. we kept something for you.' },
      { speaker: 'tarrow', text: "Don't go. ...You're going. Then go armed, and come back." },
    ],
  },
  c2m5_debrief: {
    panels: [
      { speaker: 'choir', text: 'you break our echo. we have more. we keep what we eat. we kept her.' },
      { speaker: 'tarrow', text: "Whatever nests at the Swarm Scar is wearing a Compact hull. I know which one." },
      { speaker: 'tarrow', text: 'The Constant. My sister ship. She went into a lane during the Hush with nine hundred crew. I need to see her.' },
    ],
  },
  c2_boss_intro: {
    kicker: 'Chapter 2 finale', title: 'The Constant', art: 'art/pixel/cinematic/v2/constant.png',
    panels: [
      { speaker: 'tarrow', text: 'The thing at the Scar is the Constant, regrown by the Swarm. Same hull. Wrong crew. It will take more than one pass.' },
      { speaker: 'constant', text: 'she sings now. she sings for us.' },
    ],
  },
  c2_boss_fall: {
    kicker: 'Chapter 2 complete', title: 'Let Her Rest',
    panels: [
      { speaker: 'tarrow', text: "The Constant is gone. Properly, this time. Thank you, Captain. I don't say that often." },
      { speaker: 'stowaway', text: "I was already in the room. I've been in your vents since the Gate. You're the only ship that sings back." },
      { speaker: 'merc_wisp', text: "I'm Wisp. I'd like to stay. I can see the things that cloak. I can see a lot of things." },
      { speaker: 'tarrow', text: 'The road to Ember Reach is open. Someone out there has been building warships in the dark.' },
    ],
  },
  c3_tease: {
    kicker: 'Next chapter', title: 'Ember Reach',
    panels: [
      { speaker: 'vell', text: "Ember Reach. The money's better, the air is worse, and someone burned a ledger I'd love to read. Soon, Captain." },
    ],
  },
});

/** Ten story missions. Encounters and places are picked for the reference crew of the days they usually fall on. */
export const MISSIONS = Object.freeze({
  c1_first_job: {
    chapter: 1, title: 'First Honest Job', client: 'vell', brief: "Medical gel for Hope's Rest. Pirates on the lane.",
    destinationId: 'colony_hope', encounterId: 'pirate_scout', danger: 'Low', twist: null,
    rewards: { credits: 60, medals: 5, gems: 10 }, briefing: 'c1m1_brief', debrief: 'c1m1_debrief',
  },
  c1_big_mabel: {
    chapter: 1, title: 'Big Mabel', client: 'fenn', brief: 'Fly beside the oldest freighter on the Spine.',
    destinationId: 'lane_a', encounterId: 'pirate_wing', danger: 'Guarded', twist: { id: 'escort' },
    rewards: { credits: 80, medals: 6, gems: 10 }, briefing: 'c1m2_brief', debrief: 'c1m2_debrief',
  },
  c1_two_tooth: {
    chapter: 1, title: 'Two-Tooth', client: 'vell', brief: 'A corsair ace with a price on him. Crane wants it too.',
    destinationId: 'danger_belt', encounterId: 'pirate_ace', danger: 'High',
    twist: { id: 'bounty', elite: { name: 'Two-Tooth Marrik', modifier: 'veteran' } },
    rewards: { credits: 90, medals: 8, gems: 15 }, briefing: 'c1m3_brief', debrief: 'c1m3_debrief',
  },
  c1_static_song: {
    chapter: 1, title: 'Static Song', client: 'sato', brief: 'Swarm probes tagged the colony. The broods come next.',
    destinationId: 'colony_hope', encounterId: 'swarm_skirmish', danger: 'Guarded', twist: { id: 'waves' },
    rewards: { credits: 90, medals: 8, gems: 15 }, briefing: 'c1m4_brief', debrief: 'c1m4_debrief',
  },
  c1_tarrow_terms: {
    chapter: 1, title: "Tarrow's Terms", client: 'tarrow', brief: "Hold the Glass Spur while a refugee convoy runs.",
    destinationId: 'ice_spur', encounterId: 'pirate_wing', danger: 'Guarded', twist: { id: 'holdout' },
    rewards: { credits: 100, medals: 8, gems: 15 }, briefing: 'c1m5_brief', debrief: 'c1m5_debrief',
  },
  c2_past_the_gate: {
    chapter: 2, title: 'Past the Gate', client: 'tarrow', brief: 'A wraith is shadowing navy supply runs. It cloaks.',
    destinationId: 'veil_garden', encounterId: 'veil_wraith', danger: 'Guarded', twist: null,
    rewards: { credits: 100, medals: 8, gems: 15 }, briefing: 'c2m1_brief', debrief: 'c2m1_debrief',
  },
  c2_last_clinic: {
    chapter: 2, title: 'The Last Clinic', client: 'sallow', brief: 'Walk a hospital ship out of Swarm space.',
    destinationId: 'veil_haven_dock', encounterId: 'swarm_skirmish', danger: 'Guarded', twist: { id: 'escort' },
    rewards: { credits: 110, medals: 9, gems: 15 }, briefing: 'c2m2_brief', debrief: 'c2m2_debrief',
  },
  c2_wrens_trail: {
    chapter: 2, title: "Wren's Trail", client: 'blackbox', brief: "Reach Wren's buoy before the brood does.",
    destinationId: 'echo_reef', encounterId: 'swarm_probe', danger: 'Guarded', twist: { id: 'rush' },
    rewards: { credits: 110, medals: 9, gems: 15 }, briefing: 'c2m3_brief', debrief: 'c2m3_debrief',
  },
  c2_cranes_debt: {
    chapter: 2, title: "Crane's Debt", client: 'crane', brief: 'Crane is pinned at Night Well. Two broods, one Crane.',
    destinationId: 'night_well', encounterId: 'swarm_brood', danger: 'High', twist: { id: 'waves' },
    rewards: { credits: 120, medals: 10, gems: 20 }, briefing: 'c2m4_brief', debrief: 'c2m4_debrief',
  },
  c2_the_choir: {
    chapter: 2, title: 'The Choir', client: 'choir', brief: 'Something at the Hush Yard kept something for you.',
    destinationId: 'hush_yard', encounterId: 'eclipse_echo', danger: 'High', twist: null,
    rewards: { credits: 120, medals: 10, gems: 20 }, briefing: 'c2m5_brief', debrief: 'c2m5_debrief',
  },
});

/**
 * Chapters in order. `wall` is the boss (src/systems/walls.js); `needs` is the sector that must be open first;
 * `recruit` joins the crew when the wall falls (or, for captains without walls, when the next gate opens).
 */
export const CHAPTERS = Object.freeze([
  { n: 1, id: 'spur', title: 'Cheap Ship, Bad History', needs: null, wall: 'spur', gateFlag: 'veil_opened', recruit: 'merc_kal',
    open: 'c1_open', bossIntro: 'c1_boss_intro', bossFall: 'c1_boss_fall',
    missions: ['c1_first_job', 'c1_big_mabel', 'c1_two_tooth', 'c1_static_song', 'c1_tarrow_terms'] },
  { n: 2, id: 'veil', title: 'The Veil', needs: 'veil', wall: 'veil', gateFlag: 'ember_opened', recruit: 'merc_wisp',
    open: 'c2_open', bossIntro: 'c2_boss_intro', bossFall: 'c2_boss_fall', next: 'c3_tease',
    missions: ['c2_past_the_gate', 'c2_last_clinic', 'c2_wrens_trail', 'c2_cranes_debt', 'c2_the_choir'] },
]);

/** The chapter after the written ones, shown as "coming soon". */
export const NEXT_CHAPTER = Object.freeze({ n: 3, title: 'Ember Reach' });
