-- foundation-n1-compatible-with-ordinal: 16
-- 0017_players_first_build: the build version a player first announced, written once
-- when the players row is created and never updated. Rows that predate it stay NULL rather than
-- taking whatever build the player happens to run next. Nullable and additive, so the 0016 image
-- still boots and writes players after an image rollback.
ALTER TABLE players ADD COLUMN first_build TEXT;

-- The 0016 image (serving during the rollout and after an image rollback) inserts players
-- without first_build; a new row still takes the build it arrived with. BEFORE INSERT only:
-- ON CONFLICT updates keep the stored value.
CREATE FUNCTION players_first_build() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.first_build := COALESCE(NEW.first_build, NEW.last_build);
  RETURN NEW;
END $$;
CREATE TRIGGER players_first_build BEFORE INSERT ON players
  FOR EACH ROW EXECUTE FUNCTION players_first_build();
