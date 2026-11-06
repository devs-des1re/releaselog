const tag = process.argv[2] ?? '';
const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)([-+].+)?$/.exec(tag);

if (!match) {
  console.error(`Tag ${tag} is not vMAJOR.MINOR.PATCH[-prerelease]`);
  process.exit(1);
}

const major = match[1];
const core = tag.slice(1).split('+')[0];
const name = core.includes('-') ? `v${major}-beta` : `v${major}`;

process.stdout.write(`name=${name}\n`);
