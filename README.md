# AoE2 Matchup Knowledge Base

A single-page web app for Age of Empires 2: Definitive Edition players to quickly look up matchup information against opponent civilizations.

## Features

- **Quick civ lookup** - Select your civ and add opponent civs to see matchup info
- **Multi-opponent view** - Compare multiple matchups side-by-side
- **Key information at a glance:**
  - Matchup difficulty (Easy/Even/Hard)
  - Opponent's unique unit and key bonuses
  - Their unit strengths
  - Your counter units with explanations
  - Timing windows (when you're strong vs when they're strong)
  - Strategy summary
- **Persistent selection** - Your civ is saved to localStorage
- **Responsive design** - Works on mobile, desktop, and 4K monitors
- **Keyboard shortcuts** - `/` to focus opponent search, `Esc` to clear

## Usage

Open `index.html` in a browser, or serve locally:

```bash
npm run serve
```

Then visit http://localhost:3000

## Data Sources

- [SiegeEngineers/aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) - Tech tree data and civilization bonuses
- Land unit statistics extracted and processed for counter calculations

## Building

Regenerate all data from source:

```bash
npm run build
```

This runs three scripts in order:

| Script | Command | Description |
|--------|---------|-------------|
| extract | `npm run extract` | Downloads tech tree data, extracts land units → `land-units.json` |
| matchups | `npm run matchups` | Generates matchup data for all 56 civs → `data/*.json` |
| bundle | `npm run bundle` | Bundles civ data for web app → `civs-data.js` |

## Deploying to GitHub Pages

1. Push these files to your repository:
   - `index.html`
   - `civs-data.js`

2. Go to Settings → Pages → Source: Deploy from branch → `main` / `(root)`

3. Your app will be available at `https://<username>.github.io/<repo>/`

## Project Structure

```
├── index.html           # Single-page app (HTML + CSS + JS)
├── civs-data.js         # Bundled civilization data (auto-generated)
├── package.json         # npm scripts
├── build-data.js        # Script to bundle civ JSONs
├── extract-land-units.js # Script to extract unit data
├── generate-matchups.js # Script to generate matchup advice
├── land-units.json      # Extracted unit statistics
└── data/                # Per-civilization matchup files
    ├── britons.json
    ├── franks.json
    └── ... (56 civilizations)
```

## License

MIT
