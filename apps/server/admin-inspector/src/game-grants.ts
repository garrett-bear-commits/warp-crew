// The game this inspector administers: its grant reward vocabulary (games/grant-vocabulary.ts).
// Mint grant and the cohort grant render their reward fields from it, confirm steps and timelines
// read rewards with it, and Fix purchase names the premium currency after it. A game points this
// at its own games/<id>/grants.ts, the vocabulary its policy enforces at mint, so the inspector
// never confirms a grant the server would refuse. Nothing else in the inspector names a game.
export { templateGrants as grantVocabulary } from '../../games/template/grants.ts';
