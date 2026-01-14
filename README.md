# Age of Empires 2 Civilization Matchup Guide

A quick-reference web app for AoE2 players to check opponent civilization matchups during match loading and early game. Designed for speed and usability when every second counts.

🎮 **[View Live Demo](https://yourusername.github.io/aoe2/)** *(Update with your GitHub Pages URL)*

## Features

- **Quick Civ Picker**: Select your civilization to see relevant matchup data
- **Opponent Grid**: Browse all opponent civilizations at a glance
- **Search Filter**: Instantly find the opponent you're facing
- **Detailed Counter Strategies**: Modal view with:
  - Opponent strengths to watch out for
  - Exploitable weaknesses
  - Key enemy units and how to counter them
- **Mobile Friendly**: Works on phone if you need a quick check
- **Fast Loading**: Minimal dependencies for quick access

## Screenshot

The interface features a medieval-themed dark design with gold accents, optimized for quick scanning during matches.

## GitHub Pages Deployment

### Quick Setup

1. Push this repository to GitHub
2. Go to your repository **Settings** → **Pages**
3. Under "Source", select **Deploy from a branch**
4. Select **main** branch and **/ (root)** folder
5. Click **Save**
6. Your site will be live at `https://yourusername.github.io/aoe2/`

### Manual Build

No build step required! This is a static site with vanilla HTML, CSS, and JavaScript.

## Project Structure

```
aoe2/
├── index.html          # Main application page
├── css/
│   └── styles.css      # Medieval-themed styles
├── js/
│   └── app.js          # Application logic
├── data/
│   └── britons.json    # Civilization matchup data
├── .nojekyll           # Disable Jekyll processing
└── README.md           # This file
```

## Data Structure

Each civilization file follows this JSON schema:

```json
{
  "name": "string",
  "mainStrongUnits": ["string"],
  "civilizations": [
    {
      "name": "string",
      "strengths": "string",
      "mainWeaknesses": "string",
      "mainCounterUnits": [
        {
          "name": "string",
          "defense": "string"
        }
      ]
    }
  ]
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The civilization name (e.g., "Britons") |
| `mainStrongUnits` | `string[]` | List of the civilization's key military units |
| `civilizations` | `object[]` | Array of matchup data against all other civilizations |

### Civilization Matchup Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The opponent civilization name |
| `strengths` | `string` | What makes this civilization strong against ours |
| `mainWeaknesses` | `string` | Exploitable weaknesses when facing our civilization |
| `mainCounterUnits` | `object[]` | Array of at least 3 key units to watch out for |

### Counter Unit Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The enemy unit name (first upgrade tier naming) |
| `defense` | `string` | Strategic advice on how to defend against this unit |

## Adding More Civilizations

To add a new civilization:

1. Create `data/{civilization_name}.json` (lowercase)
2. Follow the JSON structure above
3. Include matchup data for all opponent civilizations
4. Add the civ to the `availableCivs` array in `js/app.js`
5. Add display name mapping in `populateCivDropdown()` function

## Civilizations Covered

The database includes all 45 civilizations from Age of Empires 2: Definitive Edition:

- **Base Game**: Britons, Byzantines, Celts, Chinese, Franks, Goths, Japanese, Mongols, Persians, Saracens, Teutons, Turks, Vikings
- **The Conquerors**: Aztecs, Huns, Koreans, Mayans, Spanish
- **The Forgotten**: Incas, Italians, Magyars, Slavs
- **African Kingdoms**: Berbers, Ethiopians, Malians, Portuguese
- **Rise of the Rajas**: Burmese, Khmer, Malay, Vietnamese
- **The Last Khans**: Bulgarians, Cumans, Lithuanians, Tatars
- **Lords of the West**: Burgundians, Sicilians
- **Dawn of the Dukes**: Bohemians, Poles
- **Dynasties of India**: Bengalis, Dravidians, Gurjaras, Hindustanis
- **Return of Rome**: Romans
- **The Mountain Royals**: Armenians, Georgians

## Naming Convention

All unit names use the **first upgrade tier** naming (e.g., "Crossbowman" instead of "Arbalest" for the base archer line upgrade, "Two-Handed Swordsman" for infantry, etc.) unless referring to unique units or final-tier units that are the primary threat.

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch
3. Add your civilization data or improvements
4. Submit a pull request

## License

MIT License - Feel free to use and modify for your own AoE2 gaming needs!
