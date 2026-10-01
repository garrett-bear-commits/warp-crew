# The k6 load tests as a temporary service inside a deployment's private network, for runs too
# big for one source address through the public origin. Build context is this directory (on
# Railway: `railway up scripts/load --path-as-root --service loadtest --environment <env>`).
# Configure with the environment variables in common.js (BASE_URL at the API's private address).
# Runs sessions.js; another test by overriding the command, e.g. `/load/save-race.js`.
FROM grafana/k6:2.3.0
COPY common.js sessions.js save-race.js /load/
ENTRYPOINT ["k6", "run"]
CMD ["/load/sessions.js"]
