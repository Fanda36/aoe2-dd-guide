/**
 * AoE2 Civilization Matchup Generator
 * 
 * Generates per-civilization JSON files containing tactical matchup advice
 * against all opponent civilizations. Designed for quick 10-15 second reads.
 * 
 * Data sources:
 * - Remote: data.json and strings.json from SiegeEngineers/aoe2techtree
 * - Local: land-units.json for precise combat statistics
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_URL = 'https://raw.githubusercontent.com/SiegeEngineers/aoe2techtree/refs/heads/master/data/data.json';
const STRINGS_URL = 'https://raw.githubusercontent.com/SiegeEngineers/aoe2techtree/refs/heads/master/data/locales/en/strings.json';
const LAND_UNITS_FILE = path.join(__dirname, 'land-units.json');
const OUTPUT_DIR = path.join(__dirname, 'data');

// ============================================================================
// Data Fetching
// ============================================================================

/**
 * Downloads JSON from a URL
 * @param {string} url - The URL to download from
 * @returns {Promise<object>} - Parsed JSON data
 */
function downloadJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse JSON from ${url}: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Loads local land-units.json
 * @returns {object} - Parsed land units data
 */
function loadLandUnits() {
  const content = fs.readFileSync(LAND_UNITS_FILE, 'utf8');
  return JSON.parse(content);
}

// ============================================================================
// First-Tier Unit Mapping
// ============================================================================

/**
 * Builds a set of upgraded unit IDs (NOT first-tier) from unit_upgrades data
 * In the data, unit_upgrades keys are the upgraded unit IDs
 * @param {object} unitUpgrades - The unit_upgrades section from data.json
 * @returns {Set<number>} - Set of upgraded unit IDs (NOT first-tier)
 */
function buildUpgradedUnitSet(unitUpgrades) {
  const upgradedIds = new Set();
  
  // Keys in unit_upgrades are the IDs of upgraded units
  for (const upgradedId of Object.keys(unitUpgrades)) {
    upgradedIds.add(parseInt(upgradedId));
  }
  
  return upgradedIds;
}

/**
 * Checks if a unit ID is a first-tier unit (not an upgrade)
 * @param {number} unitId - The unit ID
 * @param {Set<number>} upgradedSet - Set of upgraded unit IDs
 * @returns {boolean} - True if first-tier
 */
function isFirstTierUnit(unitId, upgradedSet) {
  return !upgradedSet.has(unitId);
}

/**
 * Gets first-tier unit name for a unit (or its base unit if it's an upgrade)
 * For now, we just filter out upgraded units instead of mapping back
 * @param {number} unitId - The unit ID
 * @param {Set<number>} upgradedSet - Set of upgraded unit IDs
 * @param {object} units - The units data from data.json
 * @param {object} strings - The strings lookup
 * @returns {string|null} - First-tier unit name or null if it's an upgrade
 */
function getFirstTierName(unitId, upgradedSet, units, strings) {
  // If this is an upgraded unit, skip it
  if (upgradedSet.has(unitId)) {
    return null;
  }
  
  // This is a first-tier unit
  return getUnitName(unitId, units, strings);
}

/**
 * Gets unit name from ID using strings lookup
 * @param {number} unitId - The unit ID
 * @param {object} units - The units data
 * @param {object} strings - The strings lookup
 * @returns {string} - Unit name
 */
function getUnitName(unitId, units, strings) {
  const unit = units[unitId];
  if (!unit) return `Unknown (${unitId})`;
  
  const nameId = unit.LanguageNameId;
  if (nameId && strings[nameId]) {
    return strings[nameId];
  }
  return unit.internal_name || `Unknown (${unitId})`;
}

/**
 * Gets tech name from ID using strings lookup
 * @param {number} techId - The tech ID
 * @param {object} techs - The techs data
 * @param {object} strings - The strings lookup
 * @returns {string} - Tech name
 */
function getTechName(techId, techs, strings) {
  const tech = techs[techId];
  if (!tech) return `Unknown Tech (${techId})`;
  
  const nameId = tech.LanguageNameId;
  if (nameId && strings[nameId]) {
    return strings[nameId];
  }
  return tech.internal_name || `Unknown Tech (${techId})`;
}

// ============================================================================
// Civilization Data Extraction
// ============================================================================

/**
 * Checks if a line looks like an incomplete bonus (ends with preposition, slash, etc.)
 * @param {string} line - The line to check
 * @returns {boolean} - True if line appears incomplete
 */
function isIncompleteLine(line) {
  if (!line) return false;
  const trimmed = line.trim();
  
  // Don't join section headers (Unique Unit:, Team Bonus:, etc.)
  if (/^(unique|team)/i.test(trimmed)) return false;
  
  // Check if line ends with typical continuation patterns (slash, hyphen)
  // but NOT colon (which often ends section headers)
  return /[\/\-,;]$/.test(trimmed) || 
         /\b(in|at|to|for|of|vs|from|starting|per)$/i.test(trimmed);
}

/**
 * Extracts civilization bonuses from civ help text
 * @param {string} civName - The civilization name
 * @param {object} civHelps - The civ_helptexts mapping (civ name -> help text ID)
 * @param {object} strings - The strings lookup
 * @returns {string[]} - Array of bonus descriptions
 */
function extractCivBonuses(civName, civHelps, strings) {
  // Try to find help text ID for this civ
  const helpId = civHelps[civName];
  if (!helpId) return [];
  
  const helpText = strings[helpId];
  if (!helpText) return [];
  
  // First, normalize the text - replace <br> with a special marker
  let normalized = helpText.replace(/<br\s*\/?>/gi, '|||');
  
  // Remove HTML tags
  normalized = normalized.replace(/<[^>]+>/g, '');
  
  // Split into parts
  const parts = normalized.split('|||').map(l => l.trim()).filter(l => l);
  
  // Join lines that are continuations (previous ends with /, -, etc.)
  const joinedLines = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    if (joinedLines.length > 0 && isIncompleteLine(joinedLines[joinedLines.length - 1])) {
      // Previous line was incomplete, append this one
      joinedLines[joinedLines.length - 1] += ' ' + part;
    } else {
      joinedLines.push(part);
    }
  }
  
  const bonuses = [];
  let collectingBonuses = true;
  let teamBonusSection = false;
  
  for (const line of joinedLines) {
    // Stop at unique unit/tech sections
    if (line.toLowerCase().includes('unique unit') || 
        line.toLowerCase().includes('unique tech')) {
      collectingBonuses = false;
      continue;
    }
    
    // Team bonus section
    if (line.toLowerCase().includes('team bonus')) {
      teamBonusSection = true;
      collectingBonuses = false;
      continue;
    }
    
    // Clean line
    const cleanLine = line.replace(/^[•\-\*\s]+/, '').trim();
    
    if (!cleanLine || cleanLine.length < 5) continue;
    
    // Skip the civ type header (e.g., "Foot Archer civilization")
    if (cleanLine.toLowerCase().includes('civilization') && cleanLine.length < 50) {
      continue;
    }
    
    // Skip unit/tech names in their sections
    if (!collectingBonuses && !teamBonusSection) continue;
    
    if (collectingBonuses && cleanLine.length < 250) {
      bonuses.push(cleanLine);
    } else if (teamBonusSection && cleanLine.length < 250) {
      bonuses.push(`Team: ${cleanLine}`);
      teamBonusSection = false; // Usually just one team bonus
    }
  }
  
  return bonuses;
}

/**
 * Builds civilization help text ID mapping
 * @param {object} gameData - The full game data
 * @param {object} strings - The strings lookup
 * @returns {object} - Mapping of civ name -> help text ID
 */
function buildCivHelpMapping(gameData, strings) {
  // Use civ_helptexts if available (preferred)
  if (gameData.civ_helptexts) {
    return gameData.civ_helptexts;
  }
  
  // Fallback: try to derive from civ_names
  const mapping = {};
  const civNames = gameData.civ_names;
  
  for (const [civName, nameId] of Object.entries(civNames)) {
    const helpId = parseInt(nameId) + 1;
    if (strings[helpId] && strings[helpId].length > 50) {
      mapping[civName] = helpId;
    }
  }
  
  return mapping;
}

/**
 * Gets available units for a civilization (first-tier only)
 * @param {string} civName - The civilization name
 * @param {object} techtrees - The techtrees data
 * @param {Set<number>} upgradedSet - Set of upgraded unit IDs
 * @param {object} units - Units data
 * @param {object} strings - Strings lookup
 * @returns {string[]} - Array of first-tier unit names available to this civ
 */
function getCivAvailableUnits(civName, techtrees, upgradedSet, units, strings) {
  const civTree = techtrees[civName];
  if (!civTree) return [];
  
  const availableUnits = new Set();
  
  for (const unitEntry of civTree.units) {
    const unitId = unitEntry.id;
    
    // Only include if it's a first-tier unit (not in upgraded set)
    const name = getFirstTierName(unitId, upgradedSet, units, strings);
    if (name) {
      availableUnits.add(name);
    }
  }
  
  // Also add unique units (they're always "first tier" of their line)
  if (civTree.unique) {
    if (civTree.unique.castleAgeUniqueUnit) {
      const name = getUnitName(civTree.unique.castleAgeUniqueUnit, units, strings);
      if (name) availableUnits.add(name);
    }
  }
  
  return Array.from(availableUnits);
}

/**
 * Gets unique unit for a civilization
 * @param {string} civName - The civilization name
 * @param {object} techtrees - The techtrees data
 * @param {object} units - Units data
 * @param {object} strings - Strings lookup
 * @returns {{castle: string|null, imperial: string|null}} - Unique unit names
 */
function getCivUniqueUnits(civName, techtrees, units, strings) {
  const civTree = techtrees[civName];
  if (!civTree || !civTree.unique) return { castle: null, imperial: null };
  
  const result = { castle: null, imperial: null };
  
  if (civTree.unique.castleAgeUniqueUnit) {
    result.castle = getUnitName(civTree.unique.castleAgeUniqueUnit, units, strings);
  }
  if (civTree.unique.imperialAgeUniqueUnit) {
    result.imperial = getUnitName(civTree.unique.imperialAgeUniqueUnit, units, strings);
  }
  
  return result;
}

/**
 * Gets unique techs for a civilization
 * @param {string} civName - The civilization name
 * @param {object} techtrees - The techtrees data
 * @param {object} techs - Techs data
 * @param {object} strings - Strings lookup
 * @returns {{castle: string|null, imperial: string|null}} - Unique tech names
 */
function getCivUniqueTechs(civName, techtrees, techs, strings) {
  const civTree = techtrees[civName];
  if (!civTree || !civTree.unique) return { castle: null, imperial: null };
  
  const result = { castle: null, imperial: null };
  
  if (civTree.unique.castleAgeUniqueTech) {
    result.castle = getTechName(civTree.unique.castleAgeUniqueTech, techs, strings);
  }
  if (civTree.unique.imperialAgeUniqueTech) {
    result.imperial = getTechName(civTree.unique.imperialAgeUniqueTech, techs, strings);
  }
  
  return result;
}

// ============================================================================
// Counter Logic
// ============================================================================

/**
 * Armor class definitions for counter calculations
 */
const ARMOR_CLASSES = {
  Infantry: 1,
  Cavalry: 8,
  Archer: 15,
  CavalryArcher: 28,
  SiegeWeapon: 20,
  Monk: 25,
  Spearman: 27,
  EagleWarrior: 29,
  Camel: 30,
  UniqueUnit: 19,
  GunpowderUnit: 23,
};

/**
 * Counter matrix - maps unit types to their counters
 * Format: targetType -> [counter units with reasons]
 */
const COUNTER_MATRIX = {
  // Cavalry counters
  Cavalry: [
    { unit: 'Spearman', reason: '+15 bonus damage, very cost-efficient' },
    { unit: 'Camel', reason: '+9 bonus damage, mobile counter' },
    { unit: 'Monk', reason: 'Convert expensive units' },
  ],
  // Archer counters
  Archer: [
    { unit: 'Skirmisher', reason: '+3/+4 bonus damage, cheap trash counter' },
    { unit: 'Mangonel', reason: 'Area damage destroys archer masses' },
    { unit: 'Scout Cavalry', reason: 'Fast raiding, forces archer retreat' },
    { unit: 'Eagle Warrior', reason: 'High pierce armor, fast closing speed' },
  ],
  // Infantry counters
  Infantry: [
    { unit: 'Archer', reason: 'Kites slow infantry easily' },
    { unit: 'Knight', reason: 'High damage, mobility advantage' },
    { unit: 'Hand Cannoneer', reason: '+10 bonus vs infantry' },
  ],
  // Anti-archer infantry (Huskarl, Ghulam) - need melee to kill them
  AntiArcherInfantry: [
    { unit: 'Knight', reason: 'High melee damage, mobility' },
    { unit: 'Militia', reason: 'Infantry vs infantry, cost-efficient' },
    { unit: 'Hand Cannoneer', reason: '+10 bonus vs infantry, bypasses pierce armor' },
    { unit: 'Scorpion', reason: 'Pass-through damage kills groups' },
  ],
  // Cavalry Archer counters
  CavalryArcher: [
    { unit: 'Skirmisher', reason: 'Bonus vs archers, cheap' },
    { unit: 'Eagle Warrior', reason: 'High pierce armor, fast' },
    { unit: 'Camel', reason: 'Can catch cavalry archers' },
  ],
  // Siege counters
  SiegeWeapon: [
    { unit: 'Knight', reason: 'Fast, high damage vs slow siege' },
    { unit: 'Scout Cavalry', reason: 'Fast, snipes siege quickly' },
    { unit: 'Eagle Warrior', reason: 'Fast, bonus vs siege' },
  ],
  // Eagle counters
  EagleWarrior: [
    { unit: 'Militia', reason: '+6 bonus damage vs eagles' },
    { unit: 'Knight', reason: 'High damage output' },
  ],
  // Monk counters
  Monk: [
    { unit: 'Scout Cavalry', reason: 'Fast, cheap, kills monks quickly' },
    { unit: 'Eagle Warrior', reason: 'Fast, resistant to conversion' },
  ],
  // Spearman counters (including Kamayuk)
  Spearman: [
    { unit: 'Archer', reason: '+3 bonus vs spearman, safe range' },
    { unit: 'Skirmisher', reason: 'Cheap, bonus vs spearman' },
    { unit: 'Knight', reason: 'Despite bonus, can overwhelm with numbers' },
  ],
  // Gunpowder counters
  GunpowderUnit: [
    { unit: 'Mangonel', reason: 'Area damage, outranges hand cannons' },
    { unit: 'Scout Cavalry', reason: 'Fast closing, dodges shots' },
    { unit: 'Skirmisher', reason: 'Cheap ranged, high numbers' },
  ],
  // Camel counters (including Mameluke)
  Camel: [
    { unit: 'Archer', reason: 'Ranged damage, camels have low pierce armor' },
    { unit: 'Militia', reason: 'Infantry takes less bonus damage' },
  ],
  // Elephant counters
  Elephant: [
    { unit: 'Monk', reason: 'Convert expensive elephants' },
    { unit: 'Spearman', reason: 'Huge bonus damage vs elephants' },
    { unit: 'Camel', reason: 'Bonus damage vs elephants' },
    { unit: 'Scorpion', reason: 'High damage per shot vs slow targets' },
  ],
};

/**
 * Unique unit classification - maps unique units to their primary counter category
 */
const UNIQUE_UNIT_CLASSES = {
  // Archer-type unique units (countered by Skirmishers, Siege)
  'longbowman': 'Archer',
  'chu ko nu': 'Archer',
  'composite bowman': 'Archer',
  'plumed archer': 'Archer',
  'rattan archer': 'Archer',
  'camel archer': 'CavalryArcher',
  'genitour': 'CavalryArcher',
  'war wagon': 'CavalryArcher',
  'elephant archer': 'CavalryArcher',
  'mangudai': 'CavalryArcher',
  'kipchak': 'CavalryArcher',
  'ratha': 'CavalryArcher', // Can switch but primarily CA
  
  // Cavalry-type unique units (countered by Spearmen, Monks)
  'cataphract': 'Cavalry',
  'tarkan': 'Cavalry',
  'boyar': 'Cavalry',
  'konnik': 'Cavalry',
  'leitis': 'Cavalry',
  'keshik': 'Cavalry',
  'magyar huszar': 'Cavalry',
  'coustillier': 'Cavalry',
  'monaspa': 'Cavalry',
  'shrivamsha rider': 'Cavalry',
  'iron pagoda': 'Cavalry',
  'tiger cavalry': 'Cavalry',
  
  // Infantry-type unique units (countered by Archers, Cavalry)
  'jaguar warrior': 'Infantry',
  'woad raider': 'Infantry',
  'throwing axeman': 'Infantry',
  'huskarl': 'AntiArcherInfantry', // Special - high pierce armor
  'ghulam': 'AntiArcherInfantry', // Special - anti-archer infantry
  'shotel warrior': 'Infantry',
  'karambit warrior': 'Infantry',
  'samurai': 'Infantry',
  'teutonic knight': 'Infantry',
  'berserk': 'Infantry',
  'serjeant': 'Infantry',
  'obuch': 'Infantry',
  'urumi swordsman': 'Infantry',
  'centurion': 'Infantry',
  'legionary': 'Infantry',
  'white feather guard': 'Infantry',
  'liao dao': 'Infantry',
  'gbeto': 'Infantry', // Ranged but infantry
  
  // Spearman-type (countered by Archers, Skirms)
  'kamayuk': 'Spearman',
  'flemish militia': 'Spearman',
  
  // Siege-type (countered by Cavalry)
  'hussite wagon': 'SiegeWeapon',
  'ballista elephant': 'SiegeWeapon',
  'organ gun': 'SiegeWeapon',
  
  // Elephant-type (countered by Monks, Spearmen, Camels)
  'war elephant': 'Elephant',
  'battle elephant': 'Elephant',
  
  // Camel-type (countered by Archers, Infantry)
  'mameluke': 'Camel',
  
  // Gunpowder-type
  'janissary': 'GunpowderUnit',
  'conquistador': 'GunpowderUnit',
  'hand cannoneer': 'GunpowderUnit',
};

/**
 * Detailed unique unit categories with multiple tags
 * Categories explain unit role and what they counter/are countered by
 * @type {Object<string, {type: string, categories: string[], counters: string[], description: string}>}
 */
const UNIQUE_UNIT_CATEGORIES = {
  // Archer-type unique units
  'longbowman': {
    type: 'Archer',
    categories: ['ranged', 'long-range', 'anti-infantry'],
    counters: ['Skirmisher', 'Mangonel', 'Huskarl'],
    description: 'Extreme range archer, excels at kiting'
  },
  'chu ko nu': {
    type: 'Archer',
    categories: ['ranged', 'fast-firing', 'anti-infantry'],
    counters: ['Skirmisher', 'Mangonel', 'Huskarl'],
    description: 'Rapid-fire archer, high DPS at close range'
  },
  'composite bowman': {
    type: 'Archer',
    categories: ['ranged', 'anti-cavalry', 'anti-infantry'],
    counters: ['Skirmisher', 'Mangonel', 'Scout Cavalry'],
    description: 'Versatile archer with bonus vs cavalry'
  },
  'plumed archer': {
    type: 'Archer',
    categories: ['ranged', 'fast', 'anti-infantry', 'high-pierce-armor'],
    counters: ['Skirmisher', 'Mangonel', 'Eagle Warrior'],
    description: 'Fast archer with high pierce armor'
  },
  'rattan archer': {
    type: 'Archer',
    categories: ['ranged', 'high-pierce-armor', 'anti-infantry'],
    counters: ['Mangonel', 'Knight', 'Hand Cannoneer'],
    description: 'Tanky archer, survives arrow fire'
  },
  
  // Cavalry Archer types
  'camel archer': {
    type: 'CavalryArcher',
    categories: ['mounted-ranged', 'anti-cavalry-archer', 'mobile'],
    counters: ['Skirmisher', 'Camel', 'Eagle Warrior'],
    description: 'Mobile CA that counters other cavalry archers'
  },
  'mangudai': {
    type: 'CavalryArcher',
    categories: ['mounted-ranged', 'anti-siege', 'mobile', 'hit-and-run'],
    counters: ['Skirmisher', 'Camel', 'Eagle Warrior'],
    description: 'Best siege killer, extremely mobile'
  },
  'war wagon': {
    type: 'CavalryArcher',
    categories: ['mounted-ranged', 'tanky', 'high-pierce-armor'],
    counters: ['Halberdier', 'Monk', 'Camel'],
    description: 'Very tanky ranged unit, slow but powerful'
  },
  'kipchak': {
    type: 'CavalryArcher',
    categories: ['mounted-ranged', 'fast-firing', 'mobile'],
    counters: ['Skirmisher', 'Camel', 'Eagle Warrior'],
    description: 'Fast-firing cavalry archer'
  },
  'elephant archer': {
    type: 'CavalryArcher',
    categories: ['mounted-ranged', 'tanky', 'elephant'],
    counters: ['Halberdier', 'Monk', 'Camel'],
    description: 'Tanky elephant with ranged attack'
  },
  'genitour': {
    type: 'CavalryArcher',
    categories: ['mounted-ranged', 'anti-archer', 'trash'],
    counters: ['Knight', 'Eagle Warrior', 'Camel'],
    description: 'Mounted skirmisher, trash unit'
  },
  'ratha': {
    type: 'CavalryArcher',
    categories: ['mounted-ranged', 'switchable', 'versatile'],
    counters: ['Halberdier', 'Monk', 'Camel'],
    description: 'Can switch between melee and ranged'
  },
  
  // Cavalry unique units
  'cataphract': {
    type: 'Cavalry',
    categories: ['anti-infantry', 'anti-spearman', 'tanky'],
    counters: ['Archer', 'Camel', 'Monk'],
    description: 'Tramples infantry, resists spear bonus'
  },
  'tarkan': {
    type: 'Cavalry',
    categories: ['anti-building', 'raiding', 'high-pierce-armor'],
    counters: ['Halberdier', 'Camel', 'Monk'],
    description: 'Building destroyer, high pierce armor'
  },
  'boyar': {
    type: 'Cavalry',
    categories: ['tanky', 'high-melee-armor', 'frontline'],
    counters: ['Halberdier', 'Camel', 'Monk'],
    description: 'Extremely high melee armor'
  },
  'konnik': {
    type: 'Cavalry',
    categories: ['dismounts', 'versatile', 'value'],
    counters: ['Halberdier', 'Archer', 'Monk'],
    description: 'Dismounts as infantry when killed'
  },
  'leitis': {
    type: 'Cavalry',
    categories: ['armor-ignoring', 'anti-tanky', 'glass-cannon'],
    counters: ['Halberdier', 'Archer', 'Monk'],
    description: 'Ignores armor, melts tanky units'
  },
  'keshik': {
    type: 'Cavalry',
    categories: ['gold-generation', 'sustainable', 'raiding'],
    counters: ['Halberdier', 'Camel', 'Monk'],
    description: 'Generates gold when attacking'
  },
  'magyar huszar': {
    type: 'Cavalry',
    categories: ['anti-siege', 'raiding', 'cheap'],
    counters: ['Halberdier', 'Camel', 'Archer'],
    description: 'Bonus vs siege, cheap and fast'
  },
  'coustillier': {
    type: 'Cavalry',
    categories: ['charge-attack', 'burst-damage', 'hit-and-run'],
    counters: ['Halberdier', 'Camel', 'Monk'],
    description: 'Devastating charge attack'
  },
  'monaspa': {
    type: 'Cavalry',
    categories: ['stacking-bonus', 'group-fighter', 'regeneration'],
    counters: ['Halberdier', 'Camel', 'Monk'],
    description: 'Gets stronger in groups'
  },
  'shrivamsha rider': {
    type: 'Cavalry',
    categories: ['dodge', 'anti-ranged', 'raiding'],
    counters: ['Halberdier', 'Camel', 'Militia'],
    description: 'Dodges projectiles, counters archers'
  },
  'iron pagoda': {
    type: 'Cavalry',
    categories: ['tanky', 'slow', 'heavy-cavalry'],
    counters: ['Halberdier', 'Camel', 'Monk'],
    description: 'Extremely tanky heavy cavalry'
  },
  'tiger cavalry': {
    type: 'Cavalry',
    categories: ['anti-cavalry', 'aggressive'],
    counters: ['Halberdier', 'Archer', 'Monk'],
    description: 'Bonus damage vs cavalry'
  },
  
  // Infantry unique units
  'jaguar warrior': {
    type: 'Infantry',
    categories: ['anti-infantry', 'anti-eagle', 'melee'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Destroys other infantry units'
  },
  'woad raider': {
    type: 'Infantry',
    categories: ['fast', 'raiding', 'mobile'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Fastest infantry, great for raids'
  },
  'throwing axeman': {
    type: 'Infantry',
    categories: ['ranged-infantry', 'anti-infantry'],
    counters: ['Archer', 'Knight', 'Skirmisher'],
    description: 'Ranged infantry with pass-through damage'
  },
  'huskarl': {
    type: 'Infantry',
    categories: ['anti-archer', 'high-pierce-armor', 'raiding'],
    counters: ['Hand Cannoneer', 'Champion', 'Knight'],
    description: 'Immune to archers, building raider'
  },
  'ghulam': {
    type: 'Infantry',
    categories: ['anti-archer', 'anti-ranged', 'pass-through'],
    counters: ['Hand Cannoneer', 'Champion', 'Knight'],
    description: 'Bonus vs archers, pass-through damage'
  },
  'samurai': {
    type: 'Infantry',
    categories: ['anti-unique-unit', 'fast-attack', 'versatile'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Bonus vs all unique units'
  },
  'teutonic knight': {
    type: 'Infantry',
    categories: ['tanky', 'slow', 'high-armor', 'melee-beast'],
    counters: ['Archer', 'Scorpion', 'Monk'],
    description: 'Extremely high armor but very slow'
  },
  'berserk': {
    type: 'Infantry',
    categories: ['regeneration', 'sustainable', 'attrition'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Regenerates HP over time'
  },
  'serjeant': {
    type: 'Infantry',
    categories: ['building', 'tanky', 'versatile'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Can build Donjons'
  },
  'obuch': {
    type: 'Infantry',
    categories: ['armor-shredding', 'support', 'anti-tanky'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Strips enemy armor permanently'
  },
  'urumi swordsman': {
    type: 'Infantry',
    categories: ['area-damage', 'charge-attack', 'anti-mass'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Charge attack with area damage'
  },
  'shotel warrior': {
    type: 'Infantry',
    categories: ['fast', 'glass-cannon', 'raiding'],
    counters: ['Archer', 'Knight', 'Militia'],
    description: 'Very fast but fragile'
  },
  'karambit warrior': {
    type: 'Infantry',
    categories: ['cheap', 'swarm', 'half-pop'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Half population, swarm tactics'
  },
  'centurion': {
    type: 'Infantry',
    categories: ['aura', 'support', 'tanky'],
    counters: ['Archer', 'Knight', 'Hand Cannoneer'],
    description: 'Buffs nearby infantry'
  },
  'legionary': {
    type: 'Infantry',
    categories: ['anti-cavalry', 'charge-resistance', 'tanky'],
    counters: ['Archer', 'Scorpion', 'Hand Cannoneer'],
    description: 'Bonus vs cavalry, resists charges'
  },
  'gbeto': {
    type: 'Infantry',
    categories: ['ranged-infantry', 'fast', 'glass-cannon'],
    counters: ['Archer', 'Knight', 'Skirmisher'],
    description: 'Fast ranged infantry'
  },
  
  // Spearman types
  'kamayuk': {
    type: 'Spearman',
    categories: ['anti-cavalry', 'long-reach', 'stacking'],
    counters: ['Archer', 'Skirmisher', 'Hand Cannoneer'],
    description: 'Long reach, attacks from behind'
  },
  'flemish militia': {
    type: 'Spearman',
    categories: ['anti-cavalry', 'convertible', 'one-time'],
    counters: ['Archer', 'Scorpion', 'Knight'],
    description: 'Converts all villagers once'
  },
  
  // Siege types
  'hussite wagon': {
    type: 'SiegeWeapon',
    categories: ['ranged-siege', 'anti-archer', 'protection'],
    counters: ['Knight', 'Bombard Cannon', 'Onager'],
    description: 'Mobile protection for archers'
  },
  'ballista elephant': {
    type: 'SiegeWeapon',
    categories: ['elephant', 'siege', 'pass-through'],
    counters: ['Monk', 'Halberdier', 'Bombard Cannon'],
    description: 'Mobile scorpion on elephant'
  },
  'organ gun': {
    type: 'SiegeWeapon',
    categories: ['anti-infantry', 'area-damage', 'gunpowder'],
    counters: ['Knight', 'Bombard Cannon', 'Onager'],
    description: 'Area damage vs infantry masses'
  },
  
  // Elephant types
  'war elephant': {
    type: 'Elephant',
    categories: ['tanky', 'slow', 'area-damage', 'expensive'],
    counters: ['Monk', 'Halberdier', 'Scorpion'],
    description: 'Massive HP, trample damage'
  },
  'battle elephant': {
    type: 'Elephant',
    categories: ['tanky', 'area-damage', 'frontline'],
    counters: ['Monk', 'Halberdier', 'Camel'],
    description: 'Generic tanky elephant'
  },
  
  // Camel types  
  'mameluke': {
    type: 'Camel',
    categories: ['anti-cavalry', 'ranged-melee', 'mobile'],
    counters: ['Archer', 'Halberdier', 'Militia'],
    description: 'Ranged attack, bonus vs cavalry'
  },
  
  // Gunpowder types
  'janissary': {
    type: 'GunpowderUnit',
    categories: ['anti-infantry', 'high-damage', 'fragile'],
    counters: ['Archer', 'Knight', 'Mangonel'],
    description: 'High damage gunpowder, no minimum range'
  },
  'conquistador': {
    type: 'GunpowderUnit',
    categories: ['mounted-gunpowder', 'mobile', 'raiding'],
    counters: ['Halberdier', 'Skirmisher', 'Camel'],
    description: 'Mobile gunpowder unit'
  },
};

/**
 * Gets detailed categories for a unique unit
 * @param {string} unitName - Unit name
 * @returns {{type: string, categories: string[], counters: string[], description: string}|null}
 */
function getUniqueUnitCategories(unitName) {
  if (!unitName) return null;
  const name = unitName.toLowerCase();
  return UNIQUE_UNIT_CATEGORIES[name] || null;
}

/**
 * Gets the primary armor class for a unit based on its name
 * @param {string} unitName - The unit name
 * @returns {string|null} - Primary armor class
 */
function getUnitArmorClass(unitName) {
  const name = unitName.toLowerCase();
  
  // Check unique units first (most specific)
  if (UNIQUE_UNIT_CLASSES[name]) {
    return UNIQUE_UNIT_CLASSES[name];
  }
  
  // Order matters - check more specific patterns first
  if (name.includes('eagle')) return 'EagleWarrior';
  if (name.includes('camel') && !name.includes('archer')) return 'Camel';
  if (name.includes('elephant')) return 'Elephant';
  if (name.includes('cavalry archer')) return 'CavalryArcher';
  if (name.includes('spear') || name.includes('pike') || name.includes('halberd')) return 'Spearman';
  if (name.includes('archer') || name.includes('crossbow') || name.includes('arbalest') || name.includes('longbow')) return 'Archer';
  if (name.includes('skirmisher')) return 'Archer';
  if (name.includes('knight') || name.includes('cavalier') || name.includes('paladin')) return 'Cavalry';
  if (name.includes('scout') || name.includes('hussar') || name.includes('light cavalry')) return 'Cavalry';
  if (name.includes('militia') || name.includes('man-at-arms') || name.includes('swordsman') || name.includes('champion')) return 'Infantry';
  if (name.includes('ram') || name.includes('mangonel') || name.includes('onager') || name.includes('scorpion') || name.includes('trebuchet')) return 'SiegeWeapon';
  if (name.includes('monk')) return 'Monk';
  if (name.includes('hand cannoneer') || name.includes('bombard')) return 'GunpowderUnit';
  
  return null;
}

/**
 * Gets counters for a given opponent unit, filtered by available units
 * @param {string} opponentUnit - The opponent's unit name
 * @param {string[]} availableUnits - Units available to the player's civ
 * @returns {Array<{unit: string, reason: string}>} - Available counters
 */
function getCountersFor(opponentUnit, availableUnits) {
  const armorClass = getUnitArmorClass(opponentUnit);
  if (!armorClass || !COUNTER_MATRIX[armorClass]) {
    return [];
  }
  
  const counters = COUNTER_MATRIX[armorClass];
  const availableSet = new Set(availableUnits.map(u => u.toLowerCase()));
  
  return counters.filter(counter => {
    const counterLower = counter.unit.toLowerCase();
    // Check if any available unit matches (partial match for variations)
    return availableUnits.some(avail => 
      avail.toLowerCase().includes(counterLower) || 
      counterLower.includes(avail.toLowerCase())
    );
  });
}

/**
 * Scores a counter unit based on how well it matches the user's civ bonuses
 * Higher score = better match with civ strengths
 * @param {string} counterUnit - The counter unit name
 * @param {string} userCiv - The user's civilization
 * @returns {number} - Priority score
 */
function scoreCounterForCiv(counterUnit, userCiv) {
  const lower = counterUnit.toLowerCase();
  let score = 0;
  
  // Get civ description for type matching
  const civDesc = CIV_DESCRIPTIONS[userCiv];
  if (!civDesc) return 0;
  
  const civType = civDesc.type.toLowerCase();
  const civTags = civDesc.tags.map(t => t.toLowerCase());
  
  // Archer civs prefer archer-based counters
  if (civType.includes('archer') || civTags.some(t => t.includes('archer'))) {
    if (lower.includes('archer') || lower.includes('skirmisher')) score += 5;
  }
  
  // Cavalry civs prefer cavalry-based counters
  if (civType.includes('cavalry') || civTags.some(t => t.includes('cavalry') || t.includes('knight'))) {
    if (lower.includes('knight') || lower.includes('cavalry') || lower.includes('scout') || 
        lower.includes('hussar') || lower.includes('camel')) score += 5;
  }
  
  // Infantry civs prefer infantry counters
  if (civType.includes('infantry') || civTags.some(t => t.includes('infantry'))) {
    if (lower.includes('militia') || lower.includes('spearman') || lower.includes('champion') ||
        lower.includes('man-at-arms')) score += 5;
  }
  
  // Siege civs prefer siege counters
  if (civType.includes('siege') || civTags.some(t => t.includes('siege'))) {
    if (lower.includes('mangonel') || lower.includes('scorpion') || lower.includes('onager')) score += 5;
  }
  
  // Monk civs get bonus for monk counters
  if (civTags.some(t => t.includes('monk'))) {
    if (lower.includes('monk')) score += 5;
  }
  
  // Gunpowder civs prefer gunpowder
  if (civType.includes('gunpowder') || civTags.some(t => t.includes('gunpowder'))) {
    if (lower.includes('hand cannoneer') || lower.includes('cannon')) score += 5;
  }
  
  // Camel civs prefer camel counters
  if (civType.includes('camel') || civTags.some(t => t.includes('camel'))) {
    if (lower.includes('camel')) score += 5;
  }
  
  // Specific civ bonuses
  switch (userCiv) {
    case 'Britons':
      if (lower.includes('archer') || lower.includes('skirmisher')) score += 3; // Extra range
      break;
    case 'Franks':
      if (lower.includes('knight')) score += 3; // +20% HP Knights
      break;
    case 'Goths':
      if (lower.includes('militia') || lower.includes('spear')) score += 3; // Cheap infantry
      break;
    case 'Japanese':
      if (lower.includes('militia') || lower.includes('spear')) score += 3; // Fast attack infantry
      break;
    case 'Byzantines':
      if (lower.includes('camel') || lower.includes('skirmisher') || lower.includes('spear')) score += 3; // Cheap trash
      break;
    case 'Mongols':
      if (lower.includes('scout') || lower.includes('hussar')) score += 3; // Better scouts
      break;
    case 'Turks':
      if (lower.includes('hand cannoneer')) score += 3; // Better gunpowder
      break;
    case 'Teutons':
      if (lower.includes('monk')) score += 3; // Strong monks
      break;
    case 'Aztecs':
      if (lower.includes('monk') || lower.includes('eagle')) score += 3; // Strong monks
      break;
  }
  
  return score;
}

/**
 * Gets counters for a given opponent unit, filtered and prioritized by user's civ bonuses
 * @param {string} opponentUnit - The opponent's unit name
 * @param {string[]} availableUnits - Units available to the player's civ
 * @param {string} userCiv - The user's civilization
 * @returns {Array<{unit: string, reason: string, civBonus: boolean}>} - Available counters sorted by priority
 */
function getCountersForCiv(opponentUnit, availableUnits, userCiv) {
  const baseCounters = getCountersFor(opponentUnit, availableUnits);
  
  // Score and sort counters by civ priority
  const scoredCounters = baseCounters.map(counter => ({
    ...counter,
    score: scoreCounterForCiv(counter.unit, userCiv),
    civBonus: scoreCounterForCiv(counter.unit, userCiv) >= 5
  }));
  
  // Sort by score descending
  scoredCounters.sort((a, b) => b.score - a.score);
  
  return scoredCounters;
}

// ============================================================================
// Matchup Generation
// ============================================================================

// ============================================================================
// Civilization Classification
// ============================================================================

/**
 * Meso American civilizations (no cavalry, use Eagles instead)
 */
const MESO_CIVS = ['Aztecs', 'Mayans', 'Incas'];

/**
 * Cavalry-focused civilizations
 */
const CAVALRY_CIVS = ['Franks', 'Huns', 'Mongols', 'Persians', 'Magyars', 'Berbers', 'Cumans', 'Lithuanians', 'Bulgarians', 'Burgundians', 'Poles', 'Hindustanis', 'Gurjaras'];

/**
 * Archer-focused civilizations  
 */
const ARCHER_CIVS = ['Britons', 'Mayans', 'Vietnamese', 'Ethiopians', 'Chinese', 'Koreans', 'Italians', 'Dravidians'];

/**
 * Infantry-focused civilizations
 */
const INFANTRY_CIVS = ['Goths', 'Japanese', 'Vikings', 'Aztecs', 'Burmese', 'Malians', 'Slavs', 'Celts', 'Teutons'];

/**
 * Siege-focused civilizations
 */
const SIEGE_CIVS = ['Celts', 'Slavs', 'Mongols', 'Ethiopians', 'Koreans', 'Khmer'];

/**
 * Monk/defensive civilizations
 */
const MONK_CIVS = ['Aztecs', 'Spanish', 'Burmese', 'Slavs', 'Teutons', 'Byzantines'];

/**
 * Gunpowder civilizations
 */
const GUNPOWDER_CIVS = ['Turks', 'Spanish', 'Portuguese', 'Italians', 'Bohemians'];

/**
 * Civilization descriptions with primary type and tags for quick identification
 * @type {Object<string, {type: string, tags: string[]}>}
 */
const CIV_DESCRIPTIONS = {
  // Western European
  'Britons': { type: 'Archer', tags: ['Archer', 'Defensive', 'Long Range'] },
  'Franks': { type: 'Cavalry', tags: ['Knight Rush', 'Castle Age Power'] },
  'Celts': { type: 'Infantry/Siege', tags: ['Infantry', 'Siege', 'Fast Infantry'] },
  'Teutons': { type: 'Infantry', tags: ['Infantry', 'Defensive', 'Slow Push', 'Monk'] },
  'Vikings': { type: 'Infantry/Navy', tags: ['Infantry', 'Economy', 'Water Map'] },
  'Spanish': { type: 'Gunpowder', tags: ['Gunpowder', 'Monk', 'Conquistadors'] },
  'Portuguese': { type: 'Gunpowder/Navy', tags: ['Gunpowder', 'Water Map', 'Feitoria Boom'] },
  'Italians': { type: 'Archer/Navy', tags: ['Archer', 'Gunpowder', 'Water Map', 'Cheap Age-up'] },
  'Sicilians': { type: 'Cavalry', tags: ['Cavalry', 'Damage Reduction', 'Donjon Rush'] },
  'Burgundians': { type: 'Cavalry', tags: ['Cavalry', 'Economy', 'Early Knights'] },
  
  // Eastern European
  'Goths': { type: 'Infantry', tags: ['Infantry Spam', 'Late Game', 'Huskarls'] },
  'Byzantines': { type: 'Defensive', tags: ['Defensive', 'Trash Units', 'Counter Civ', 'Camels'] },
  'Slavs': { type: 'Infantry/Siege', tags: ['Infantry', 'Siege', 'Farming Bonus'] },
  'Magyars': { type: 'Cavalry', tags: ['Cavalry', 'Scout Rush', 'Cheap Hussars'] },
  'Bulgarians': { type: 'Cavalry', tags: ['Cavalry', 'Krepost', 'Cheap Blacksmith'] },
  'Bohemians': { type: 'Gunpowder/Monk', tags: ['Gunpowder', 'Monk', 'Hussite Wagons'] },
  'Poles': { type: 'Cavalry', tags: ['Cavalry', 'Cheap Knights', 'Stone from Gold'] },
  'Lithuanians': { type: 'Cavalry', tags: ['Cavalry', 'Relic Bonus', 'Leitis'] },
  
  // Middle Eastern
  'Saracens': { type: 'Camel/Archer', tags: ['Camel', 'Archer', 'Market Bonus'] },
  'Turks': { type: 'Gunpowder', tags: ['Gunpowder', 'Free Chemistry', 'Janissaries'] },
  'Persians': { type: 'Cavalry', tags: ['Cavalry', 'War Elephants', 'Boom', 'TC Bonus'] },
  'Berbers': { type: 'Cavalry', tags: ['Cavalry', 'Camel', 'Cheap Cavalry', 'Genitours'] },
  'Hindustanis': { type: 'Camel/Gunpowder', tags: ['Camel', 'Gunpowder', 'Imperial Camel'] },
  
  // Asian
  'Chinese': { type: 'Archer', tags: ['Archer', 'Tech Discount', 'Chu Ko Nu'] },
  'Japanese': { type: 'Infantry', tags: ['Infantry', 'Fast Attack', 'Samurai'] },
  'Mongols': { type: 'Cavalry Archer', tags: ['Cavalry Archer', 'Mangudai', 'Hunt Bonus', 'Siege'] },
  'Koreans': { type: 'Defensive/Siege', tags: ['Defensive', 'Tower Rush', 'War Wagons', 'Siege'] },
  'Vietnamese': { type: 'Archer', tags: ['Archer', 'Elephant Archer', 'Reveal Enemy', 'Rattan Archer'] },
  'Burmese': { type: 'Infantry/Monk', tags: ['Infantry', 'Monk', 'Elephant', 'Reveal Relics'] },
  'Khmer': { type: 'Siege/Elephant', tags: ['Siege', 'Elephant', 'No Building Requirements', 'Fast Ballista'] },
  'Malay': { type: 'Infantry/Navy', tags: ['Infantry', 'Fast Age-up', 'Cheap Elephants', 'Water Map'] },
  'Dravidians': { type: 'Infantry/Navy', tags: ['Infantry', 'Navy', 'Urumi', 'Wootz Steel'] },
  'Bengalis': { type: 'Elephant', tags: ['Elephant', 'Ratha', 'Resist Conversion'] },
  'Gurjaras': { type: 'Cavalry', tags: ['Cavalry', 'Camel', 'Shrivamsha', 'Chakram'] },
  
  // Central Asian
  'Huns': { type: 'Cavalry', tags: ['Cavalry Archer', 'No Houses', 'Aggression', 'Tarkans'] },
  'Cumans': { type: 'Cavalry', tags: ['Cavalry', 'Feudal TC', 'Steppe Lancers', 'Fast'] },
  'Tatars': { type: 'Cavalry Archer', tags: ['Cavalry Archer', 'Hill Bonus', 'Keshik'] },
  
  // African
  'Ethiopians': { type: 'Archer', tags: ['Archer', 'Free Pikemen', 'Fast Firing Archers', 'Siege'] },
  'Malians': { type: 'Infantry', tags: ['Infantry', 'Pierce Armor Infantry', 'Gbeto', 'Gold Bonus'] },
  
  // American
  'Aztecs': { type: 'Infantry/Monk', tags: ['Infantry', 'Monk', 'Eagles', 'Relic Gold', 'Military Creation'] },
  'Mayans': { type: 'Archer', tags: ['Archer', 'Eagles', 'Boom', 'Plumed Archer', 'Longer Lasting Resources'] },
  'Incas': { type: 'Infantry', tags: ['Infantry', 'Eagles', 'Kamayuk', 'Villager Bonus'] },
  
  // Caucasus
  'Georgians': { type: 'Cavalry', tags: ['Cavalry', 'Defensive', 'Monaspa', 'Regen'] },
  'Armenians': { type: 'Infantry/Cavalry', tags: ['Infantry', 'Cavalry', 'Composite Bowman', 'Mule Cart'] },
  
  // Roman
  'Romans': { type: 'Infantry', tags: ['Infantry', 'Legionary', 'Centurion', 'Cheap Scorpions'] },
  
  // Chinese Dynasties (Three Kingdoms)
  'Jurchens': { type: 'Cavalry', tags: ['Cavalry', 'Iron Pagoda', 'Siege'] },
  'Khitans': { type: 'Cavalry Archer', tags: ['Cavalry Archer', 'Raiding', 'Economy'] },
  'Shu': { type: 'Infantry', tags: ['Infantry', 'Defensive', 'Zhuge Crossbow'] },
  'Wei': { type: 'Cavalry', tags: ['Cavalry', 'Tiger Cavalry', 'Aggression'] },
  'Wu': { type: 'Navy/Infantry', tags: ['Navy', 'Infantry', 'Water Map'] },
};

/**
 * Gets civ description for a civilization
 * @param {string} civName - Civilization name
 * @returns {{type: string, tags: string[]}|null}
 */
function getCivDescription(civName) {
  return CIV_DESCRIPTIONS[civName] || null;
}

/**
 * Determines matchup difficulty based on civ characteristics
 * @param {string} userCiv - User's civilization
 * @param {string} opponentCiv - Opponent's civilization
 * @param {Array} opponentStrengths - Opponent's identified strengths
 * @returns {string} - Difficulty rating
 */
function getMatchupDifficulty(userCiv, opponentCiv, opponentStrengths) {
  // Known hard matchups for specific civs
  const hardMatchups = {
    'Britons': ['Goths', 'Huskarls', 'Celts', 'Slavs', 'Mongols'], // Anti-archer civs
    'Franks': ['Byzantines', 'Saracens', 'Berbers', 'Hindustanis'], // Anti-cavalry civs
    'Goths': ['Mayans', 'Britons', 'Ethiopians'], // Archer civs destroy Goths early
  };
  
  const easyMatchups = {
    'Britons': ['Franks', 'Persians', 'Huns'], // Cavalry civs vulnerable to archers + pikes
    'Franks': ['Britons', 'Mayans', 'Vietnamese'], // Archer civs without good anti-cav
    'Goths': ['Franks', 'Teutons', 'Slavs'], // Infantry civs
  };
  
  if (hardMatchups[userCiv]?.includes(opponentCiv)) {
    return 'Hard';
  }
  if (easyMatchups[userCiv]?.includes(opponentCiv)) {
    return 'Favorable';
  }
  
  return 'Even';
}

/**
 * Per-civilization peak timings for opponent warnings
 * Helps user know when opponent is strongest and what to prepare for
 * @type {Object<string, {peakAge: string, timing: string, warning: string}>}
 */
const CIV_PEAK_TIMINGS = {
  // Western European
  'Britons': { peakAge: 'Castle', timing: 'Castle Age Crossbow mass with +1/+2 range', warning: 'Dont fight archers head-on without Skirmishers or siege' },
  'Franks': { peakAge: 'Castle', timing: 'Knight rush at minute 17-20 with +20% HP', warning: 'Have Spearmen/Monks ready before minute 17' },
  'Celts': { peakAge: 'Imperial', timing: 'Siege Onagers with Furor Celtica', warning: 'Snipe siege early, dont let them mass Onagers' },
  'Teutons': { peakAge: 'Imperial', timing: 'Slow push with Teutonic Knights + siege', warning: 'Avoid melee fights, use archers and mobility' },
  'Vikings': { peakAge: 'Castle/Imperial', timing: 'Economy advantage compounds over time', warning: 'Pressure early before economy lead is too large' },
  'Spanish': { peakAge: 'Imperial', timing: 'Fast-firing gunpowder and Missionaries', warning: 'Pressure before Imperial gunpowder arrives' },
  'Portuguese': { peakAge: 'Imperial', timing: 'Feitoria infinite resources', warning: 'End game before Feitorias sustain them forever' },
  'Italians': { peakAge: 'Castle', timing: 'Genoese Crossbowmen destroy cavalry', warning: 'Dont rely on pure cavalry vs Italians' },
  'Sicilians': { peakAge: 'Castle', timing: 'Serjeants + 50% damage reduction', warning: 'Bonus damage is less effective - use raw damage' },
  'Burgundians': { peakAge: 'Castle', timing: 'Early Cavalier (one age earlier)', warning: 'Expect Castle Age Cavalier timing around minute 25' },

  // Eastern European
  'Goths': { peakAge: 'Imperial', timing: 'Post-Imperial Perfusion infantry spam', warning: 'DO NOT let them reach Imperial with economy intact' },
  'Byzantines': { peakAge: 'Imperial', timing: 'Cheap trash and Cataphracts', warning: 'Win before trash war, or have better late game eco' },
  'Slavs': { peakAge: 'Imperial', timing: 'Druzhina Champions with splash damage', warning: 'Avoid infantry blobs vs Slavs' },
  'Magyars': { peakAge: 'Feudal', timing: 'Scout rush with free forging', warning: 'Wall early, expect aggressive Feudal Scouts' },
  'Bulgarians': { peakAge: 'Castle', timing: 'Krepost + Stirrups Knights', warning: 'Expect forward Krepost with Konniks' },
  'Bohemians': { peakAge: 'Castle/Imperial', timing: 'Hussite Wagons protect archers, Houfnice late', warning: 'Snipe wagons with cavalry, avoid prolonged siege fights' },
  'Poles': { peakAge: 'Castle', timing: 'Cheap Cavalier with stone from gold', warning: 'Expect lots of cavalry, prepare Spearmen' },
  'Lithuanians': { peakAge: 'Imperial', timing: 'Leitis with 4+ relics (+4 attack, ignores armor)', warning: 'Deny relics or fight before they collect 4+' },

  // Middle Eastern
  'Saracens': { peakAge: 'Imperial', timing: 'Mameluke mass and siege', warning: 'Mamelukes counter cavalry - use archers instead' },
  'Turks': { peakAge: 'Imperial', timing: 'Free Chemistry Janissaries and Artillery BBCs', warning: 'Pressure before Imperial, they have no trash' },
  'Persians': { peakAge: 'Castle', timing: 'Fast Castle Knights with TC bonus', warning: 'Expect fast Castle Knight flood, have Spears ready' },
  'Berbers': { peakAge: 'Castle', timing: 'Cheap cavalry flood', warning: 'They produce cavalry faster due to discount' },
  'Hindustanis': { peakAge: 'Imperial', timing: 'Imperial Camels and Shatagni Hand Cannoneers', warning: 'Imperial Camels destroy all cavalry' },

  // Asian
  'Chinese': { peakAge: 'Imperial', timing: 'Tech discount compounds into late game', warning: 'They out-upgrade you - pressure early' },
  'Japanese': { peakAge: 'Feudal', timing: 'MAA with 33% faster attack speed', warning: 'Expect aggressive Feudal infantry, wall early' },
  'Mongols': { peakAge: 'Castle/Imperial', timing: 'Mangudai hit-and-run and Drill siege', warning: 'Mangudai destroy siege - protect your siege' },
  'Koreans': { peakAge: 'Castle', timing: 'War Wagons or tower rush', warning: 'Scout for towers, War Wagons are tanky' },
  'Vietnamese': { peakAge: 'Castle/Imperial', timing: 'Extra HP archers and Rattan Archers', warning: 'Their archers are tankier than normal' },
  'Burmese': { peakAge: 'Castle', timing: 'Arambai raids', warning: 'Arambai are devastating in small numbers - protect villagers' },
  'Khmer': { peakAge: 'Castle', timing: 'Fast Castle (no building requirements)', warning: 'Expect very fast Castle Age timing' },
  'Malay': { peakAge: 'Castle', timing: '66% faster age-up into cheap Battle Elephants', warning: 'They reach Castle Age much earlier than expected' },
  'Dravidians': { peakAge: 'Imperial', timing: 'Wootz Steel infantry ignores armor', warning: 'Armor doesnt help vs Wootz Steel - use archers' },
  'Bengalis': { peakAge: 'Castle', timing: 'Rathas (ranged/melee switch)', warning: 'Rathas are versatile - hard to counter' },
  'Gurjaras': { peakAge: 'Castle', timing: 'Shrivamsha Riders dodge arrows', warning: 'Shrivamshas counter archers - use melee units' },

  // Central Asian
  'Huns': { peakAge: 'Castle', timing: 'No houses - fast aggressive CA and Knights', warning: 'Expect early aggression, they have housing advantage' },
  'Cumans': { peakAge: 'Feudal', timing: 'Feudal 2nd TC', warning: 'Pressure their Feudal TC or they boom hard' },
  'Tatars': { peakAge: 'Castle', timing: 'Hill bonus and Keshiks', warning: 'Fight on flat ground, avoid hill disadvantage' },

  // African
  'Ethiopians': { peakAge: 'Castle', timing: '18% faster firing archers + free Pikemen', warning: 'Their archers fire faster - respect the DPS' },
  'Malians': { peakAge: 'Castle/Imperial', timing: 'Pierce armor infantry and Gbetos', warning: 'Their infantry survives arrows - use melee or HC' },

  // American
  'Aztecs': { peakAge: 'Imperial', timing: 'Garland Wars Eagles (+4 attack) + fast production', warning: 'Imperial Eagles are devastating vs archers' },
  'Mayans': { peakAge: 'Imperial', timing: 'El Dorado Eagles (+40 HP)', warning: 'Imperial Eagles have 100 HP - prepare Champions' },
  'Incas': { peakAge: 'Castle', timing: 'Kamayuks + villager bonus', warning: 'Kamayuks destroy cavalry, even Knights' },

  // Caucasus
  'Georgians': { peakAge: 'Castle', timing: 'Monaspas get stronger in groups', warning: 'Dont let them mass Monaspas' },
  'Armenians': { peakAge: 'Castle', timing: 'Earlier infantry upgrades', warning: 'Their infantry upgrades come earlier than expected' },

  // Roman
  'Romans': { peakAge: 'Imperial', timing: 'Legionaries resist charges, cheap Scorpions', warning: 'Dont charge into Legionaries - use ranged' },

  // Chinese Dynasties
  'Jurchens': { peakAge: 'Imperial', timing: 'Iron Pagoda heavy cavalry', warning: 'Iron Pagodas are very tanky' },
  'Khitans': { peakAge: 'Castle', timing: 'Cavalry Archer raids', warning: 'Expect CA harassment, protect eco' },
  'Shu': { peakAge: 'Castle', timing: 'Defensive bonuses', warning: 'Hard to push, find flanks' },
  'Wei': { peakAge: 'Castle', timing: 'Tiger Cavalry aggression', warning: 'Expect aggressive cavalry, have Spears' },
  'Wu': { peakAge: 'Castle', timing: 'Naval + infantry', warning: 'Dangerous on hybrid maps' },
};

/**
 * Per-civilization timing windows with specific power spikes
 * @type {Object<string, {yourStrength: string, peakAge: string, powerSpikes: string[]}>}
 */
const CIV_TIMING_WINDOWS = {
  // Western European
  'Britons': {
    yourStrength: 'Castle Age Crossbow mass with +1/+2 range bonus',
    peakAge: 'Castle',
    powerSpikes: ['Feudal Archer harass', 'Castle Age +1 range Crossbows', 'Imperial Longbowmen with Yeomen (+1 range)']
  },
  'Franks': {
    yourStrength: 'Castle Age Knight rush with +20% HP bonus',
    peakAge: 'Castle',
    powerSpikes: ['Fast Castle into Knights (minute 17-19)', 'Castle Age Knight mass', 'Imperial Paladin with Bearded Axe']
  },
  'Celts': {
    yourStrength: 'Feudal/Castle infantry pressure with 15% faster infantry',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Feudal MAA with speed bonus', 'Castle Age Woad Raiders', 'Imperial Siege Onagers with Furor Celtica']
  },
  'Teutons': {
    yourStrength: 'Castle/Imperial slow push with melee armor and conversions',
    peakAge: 'Imperial',
    powerSpikes: ['Castle Age Knights with +2 melee armor', 'Imperial Teutonic Knights', 'Siege + Teutonic Knight deathball']
  },
  'Vikings': {
    yourStrength: 'Castle Age economy lead into infantry flood',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Wheelbarrow/Hand Cart savings kick in', 'Castle Age Berserks', 'Imperial Chieftains Champions']
  },
  'Spanish': {
    yourStrength: 'Castle Age Conquistadors, Imperial gunpowder',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Castle Age Conquistadors', 'Imperial faster firing gunpowder', 'Missionaries with Inquisition']
  },
  'Portuguese': {
    yourStrength: 'Castle Age Organ Guns, Imperial Feitoria boom',
    peakAge: 'Imperial',
    powerSpikes: ['Gold discount on all units', 'Castle Age Organ Guns', 'Imperial Feitoria for infinite resources']
  },
  'Italians': {
    yourStrength: 'Cheap age-up into Genoese Crossbowmen',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Age-up discount timing', 'Castle Age Genoese Crossbowmen vs cavalry', 'Imperial Condottiero vs gunpowder']
  },
  'Sicilians': {
    yourStrength: 'Castle Age Serjeants with Donjon forward',
    peakAge: 'Castle',
    powerSpikes: ['Feudal Donjon rush', 'Castle Age Serjeants + damage reduction', 'Imperial Hauberk Cavalier']
  },
  'Burgundians': {
    yourStrength: 'Early Cavalier timing with economic upgrades',
    peakAge: 'Castle/Early Imperial',
    powerSpikes: ['Early economic upgrades', 'Castle Age Cavalier (one age earlier)', 'Imperial Coustillier charge']
  },

  // Eastern European
  'Goths': {
    yourStrength: 'Imperial Age instant infantry spam with Perfusion',
    peakAge: 'Imperial',
    powerSpikes: ['Feudal MAA flood (cheaper)', 'Castle Age Huskarl transition', 'Post-Imperial Perfusion infantry spam']
  },
  'Byzantines': {
    yourStrength: 'Cheap trash units and counter compositions',
    peakAge: 'Imperial',
    powerSpikes: ['Castle Age cheap Camels', 'Imperial Cataphracts vs infantry', 'Trash war with cheap Hussars/Skirms/Halbs']
  },
  'Slavs': {
    yourStrength: 'Farming bonus into infantry/siege deathball',
    peakAge: 'Imperial',
    powerSpikes: ['Faster farming kicks in early', 'Castle Age Boyars', 'Imperial Druzhina Champions splash damage']
  },
  'Magyars': {
    yourStrength: 'Feudal Scout rush, cheap Hussars in Imperial',
    peakAge: 'Feudal/Imperial',
    powerSpikes: ['Feudal free forging Scout rush', 'Castle Age Magyar Huszar', 'Imperial free attack upgrades cavalry']
  },
  'Bulgarians': {
    yourStrength: 'Cheap Blacksmith into Konnik spam',
    peakAge: 'Castle',
    powerSpikes: ['Krepost forward with Konniks', 'Castle Age Stirrups Knights', 'Imperial Konnik army']
  },
  'Bohemians': {
    yourStrength: 'Castle Age Hussite Wagons, Houfnice in Imperial',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Castle Age Hussite Wagon deathball', 'Imperial Houfnice (better BBC)', 'Monk + wagon composition']
  },
  'Poles': {
    yourStrength: 'Cheap Cavaliers with stone from gold',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Folwark farming bonus', 'Castle Age cheap Cavalier', 'Imperial Winged Hussar + Obuch']
  },
  'Lithuanians': {
    yourStrength: 'Relic-boosted Leitis ignoring armor',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Fast Relic collection', 'Castle Age Leitis', 'Imperial Leitis with 4+ relics (+4 attack)']
  },

  // Middle Eastern
  'Saracens': {
    yourStrength: 'Market abuse into Mameluke mass',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Market bonus for fast age-up', 'Castle Age Mamelukes', 'Imperial Mameluke + siege']
  },
  'Turks': {
    yourStrength: 'Free Chemistry Janissaries in Castle Age',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Castle Age Janissaries (free Chemistry)', 'Imperial Artillery Bombard Cannons', 'Sipahi Cavalry Archers']
  },
  'Persians': {
    yourStrength: 'Fast Castle into Knights, War Elephants late',
    peakAge: 'Castle',
    powerSpikes: ['TC work rate bonus', 'Fast Castle Knights', 'Imperial War Elephants with Mahouts']
  },
  'Berbers': {
    yourStrength: 'Cheap cavalry and Camel Archers',
    peakAge: 'Castle',
    powerSpikes: ['Cheap Stable units (15-20% discount)', 'Castle Age Camel Archers', 'Imperial Genitour support']
  },
  'Hindustanis': {
    yourStrength: 'Imperial Camels and gunpowder',
    peakAge: 'Imperial',
    powerSpikes: ['Castle Age cheap Villagers from TC', 'Imperial Camel (anti-cavalry)', 'Shatagni Hand Cannoneers (+2 range)']
  },

  // Asian
  'Chinese': {
    yourStrength: 'Tech discount into Chu Ko Nu mass',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Tech discount compounds over game', 'Castle Age Chu Ko Nu', 'Imperial Rocketry Scorpions']
  },
  'Japanese': {
    yourStrength: 'Feudal MAA pressure with 33% faster attack',
    peakAge: 'Feudal/Castle',
    powerSpikes: ['Feudal 33% faster attacking infantry', 'Castle Age Samurai vs UU', 'Imperial Yasama Towers + Trebs']
  },
  'Mongols': {
    yourStrength: 'Castle Age Mangudai raid, Imperial siege',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Hunt bonus for fast Feudal', 'Castle Age Mangudai hit-and-run', 'Imperial Drill Siege Onagers']
  },
  'Koreans': {
    yourStrength: 'Tower rush or War Wagon mass',
    peakAge: 'Castle',
    powerSpikes: ['Feudal/Castle tower rush', 'Castle Age War Wagons', 'Imperial Shinkichon Onagers (+1 range)']
  },
  'Vietnamese': {
    yourStrength: 'Archer play with extra HP',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Reveal enemy TC start', 'Castle Age Rattan Archers', 'Imperial Chatras Battle Elephants']
  },
  'Burmese': {
    yourStrength: 'Free Lumber Camp upgrades into Arambai',
    peakAge: 'Castle',
    powerSpikes: ['Free lumber upgrades economy', 'Castle Age Arambai', 'Imperial Manipur Cavalry (+6 vs archers)']
  },
  'Khmer': {
    yourStrength: 'Fast Castle (no building requirements), Ballista Elephants',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['No building requirement age-up', 'Castle Age Ballista Elephants', 'Imperial Scorpions with Double Crossbow']
  },
  'Malay': {
    yourStrength: 'Fast age-up, cheap Battle Elephants',
    peakAge: 'Castle',
    powerSpikes: ['66% faster age-up', 'Castle Age cheap Battle Elephants', 'Imperial Forced Levy 2HS (no gold)']
  },
  'Dravidians': {
    yourStrength: 'Wood bonus into Urumi and Wootz Steel',
    peakAge: 'Imperial',
    powerSpikes: ['Wood bonus early economy', 'Castle Age Urumi Swordsmen', 'Imperial Wootz Steel (ignore armor)']
  },
  'Bengalis': {
    yourStrength: 'Ratha flexibility and elephant resistance',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Castle Age Rathas (ranged/melee switch)', 'Elephants resist conversion', 'Imperial Paiks Rathas']
  },
  'Gurjaras': {
    yourStrength: 'Camel and cavalry with bonus damage',
    peakAge: 'Castle',
    powerSpikes: ['Mill bonus food', 'Castle Age Shrivamsha Riders', 'Imperial Chakram Throwers + Camels']
  },

  // Central Asian
  'Huns': {
    yourStrength: 'No houses, aggressive Cavalry Archer play',
    peakAge: 'Castle',
    powerSpikes: ['No house advantage early', 'Castle Age Cavalry Archers', 'Imperial Tarkans for raiding']
  },
  'Cumans': {
    yourStrength: 'Feudal TC boom or Steppe Lancer timing',
    peakAge: 'Feudal/Castle',
    powerSpikes: ['Feudal 2nd TC (unique)', 'Castle Age Kipchaks/Steppe Lancers', 'Imperial Cuman Mercenaries']
  },
  'Tatars': {
    yourStrength: 'Hill bonus and Keshik gold generation',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Extra sheep for scout rush', 'Castle Age Keshiks', 'Imperial Silk Armor Cavalry Archers']
  },

  // African
  'Ethiopians': {
    yourStrength: 'Free Pikemen, fast-firing archers',
    peakAge: 'Castle',
    powerSpikes: ['Free Pikemen upgrade', 'Castle Age 18% faster firing archers', 'Imperial Torsion Engines siege']
  },
  'Malians': {
    yourStrength: 'Pierce armor infantry, Gbeto raids',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Wood bonus economy', 'Castle Age Gbetos', 'Imperial Farimba Cavaliers + pierce armor infantry']
  },

  // American
  'Aztecs': {
    yourStrength: 'Relic gold and military creation speed',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Faster military production', 'Castle Age Eagles + Monks', 'Imperial Garland Wars Eagles (+4 attack)']
  },
  'Mayans': {
    yourStrength: 'Longer lasting resources into Plumed Archers',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Resources last 15% longer', 'Castle Age Plumed Archers', 'Imperial El Dorado Eagles (+40 HP)']
  },
  'Incas': {
    yourStrength: 'Villager bonus and Kamayuk line',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Villager blacksmith upgrades', 'Castle Age Kamayuks', 'Imperial Eagles + Slingers']
  },

  // Caucasus
  'Georgians': {
    yourStrength: 'Defensive bonuses and Monaspa cavalry',
    peakAge: 'Castle',
    powerSpikes: ['Fortification bonuses', 'Castle Age Monaspas (stronger in groups)', 'Imperial regenerating cavalry']
  },
  'Armenians': {
    yourStrength: 'Early upgrades and Composite Bowmen',
    peakAge: 'Castle',
    powerSpikes: ['Earlier infantry upgrades', 'Castle Age Composite Bowmen', 'Imperial Fereters healing']
  },

  // Roman
  'Romans': {
    yourStrength: 'Cheap Scorpions and Legionary line',
    peakAge: 'Imperial',
    powerSpikes: ['Cheap Scorpions from Castle Age', 'Castle Age Centurions', 'Imperial Legionary charge resistance']
  },

  // Chinese Dynasties
  'Jurchens': {
    yourStrength: 'Iron Pagoda heavy cavalry',
    peakAge: 'Imperial',
    powerSpikes: ['Castle Age Iron Pagodas', 'Imperial heavy cavalry + siege', 'Late game deathball']
  },
  'Khitans': {
    yourStrength: 'Cavalry Archer raiding',
    peakAge: 'Castle',
    powerSpikes: ['Economy bonus early', 'Castle Age CA raids', 'Imperial Cavalry Archer mass']
  },
  'Shu': {
    yourStrength: 'Defensive play with repeating crossbow',
    peakAge: 'Castle/Imperial',
    powerSpikes: ['Defensive bonuses', 'Castle Age unique unit', 'Imperial siege support']
  },
  'Wei': {
    yourStrength: 'Aggressive Tiger Cavalry',
    peakAge: 'Castle',
    powerSpikes: ['Aggression bonus', 'Castle Age Tiger Cavalry', 'Imperial cavalry anti-cav']
  },
  'Wu': {
    yourStrength: 'Naval and infantry combination',
    peakAge: 'Castle',
    powerSpikes: ['Naval dominance', 'Castle Age infantry', 'Land/water hybrid maps']
  },
};

/**
 * Gets timing windows for a matchup based on opponent's strengths
 * @param {string} userCiv - User's civilization
 * @param {string} opponentCiv - Opponent's civilization
 * @param {Array} opponentStrengths - Opponent's identified strengths
 * @param {string[]} opponentBonuses - Opponent's civ bonuses
 * @returns {{yourStrength: string, opponentStrength: string, keyTiming: string, yourPowerSpikes: string[], opponentPowerSpikes: string[]}}
 */
function getTimingWindows(userCiv, opponentCiv, opponentStrengths, opponentBonuses) {
  // Get per-civ timing data
  const userTiming = CIV_TIMING_WINDOWS[userCiv];
  const opponentTiming = CIV_TIMING_WINDOWS[opponentCiv];
  
  let yourStrength = userTiming?.yourStrength || 'Castle Age power spike with unique units';
  let yourPowerSpikes = userTiming?.powerSpikes || [];
  
  let opponentStrength = '';
  let opponentPowerSpikes = opponentTiming?.powerSpikes || [];
  let keyTiming = '';
  
  // Use opponent-specific timing if available
  if (opponentTiming) {
    opponentStrength = `${opponentTiming.peakAge} Age - ${opponentTiming.yourStrength}`;
    
    // Generate key timing based on opponent's peak age
    switch (opponentTiming.peakAge) {
      case 'Feudal':
        keyTiming = 'Wall early, survive their Feudal pressure, outscale in Castle Age';
        break;
      case 'Feudal/Castle':
        keyTiming = 'Be ready for early aggression, have counters prepared';
        break;
      case 'Castle':
        keyTiming = 'Match their Castle Age timing or apply Feudal pressure';
        break;
      case 'Castle/Imperial':
        keyTiming = 'Apply Castle Age pressure before they peak';
        break;
      case 'Castle/Early Imperial':
        keyTiming = 'Pressure in Castle Age or prepare for early Imperial timing';
        break;
      case 'Imperial':
        keyTiming = 'DO NOT let them reach Imperial without damage - pressure early';
        break;
      default:
        keyTiming = 'Apply pressure in Castle Age';
    }
  } else {
    // Fallback to category-based timing
    if (MESO_CIVS.includes(opponentCiv)) {
      opponentStrength = 'Imperial Age when Eagles are fully upgraded (+4 armor, +60 HP)';
      keyTiming = 'End game before Imperial or have infantry ready';
    } else if (CAVALRY_CIVS.includes(opponentCiv)) {
      opponentStrength = 'Castle Age Knight rush and Imperial Paladin timing';
      keyTiming = 'Have Spearmen ready by minute 18-20';
    } else if (INFANTRY_CIVS.includes(opponentCiv)) {
      opponentStrength = 'Imperial Age with Champion spam or unique infantry';
      keyTiming = 'Maintain archer mass and mobility';
    } else if (SIEGE_CIVS.includes(opponentCiv)) {
      opponentStrength = 'Castle Age Mangonel timing and Imperial Siege Onagers';
      keyTiming = 'Split archers vs siege, have cavalry ready to snipe';
    } else if (GUNPOWDER_CIVS.includes(opponentCiv)) {
      opponentStrength = 'Imperial Age with Hand Cannoneers/Bombard Cannons';
      keyTiming = 'Pressure early, dont let them boom to Imperial';
    } else {
      opponentStrength = 'Imperial Age with full upgrades';
      keyTiming = 'Apply pressure in Castle Age';
    }
  }
  
  return { 
    yourStrength, 
    opponentStrength, 
    keyTiming,
    yourPowerSpikes,
    opponentPowerSpikes
  };
}

/**
 * Scores a bonus by its military impact/strength
 * Higher scores = more impactful bonuses
 * @param {string} bonus - The bonus text
 * @returns {number} - Impact score
 */
function scoreBonusStrength(bonus) {
  let score = 0;
  const lower = bonus.toLowerCase();
  
  // Free things are always very strong
  if (lower.includes('free')) score += 15;
  
  // Numeric bonuses with + sign indicate direct stat improvements
  if (/\+\d+/.test(lower)) {
    score += 8;
    // Higher numbers are better
    const matches = lower.match(/\+(\d+)/g);
    if (matches) {
      for (const match of matches) {
        const num = parseInt(match.replace('+', ''));
        if (num >= 10) score += 5;
        else if (num >= 5) score += 3;
        else score += 1;
      }
    }
  }
  
  // Percentage bonuses
  if (/\d+%/.test(lower)) {
    score += 6;
    const matches = lower.match(/(\d+)%/g);
    if (matches) {
      for (const match of matches) {
        const num = parseInt(match.replace('%', ''));
        if (num >= 25) score += 5;
        else if (num >= 15) score += 3;
        else score += 1;
      }
    }
  }
  
  // Attack/damage bonuses are critical
  if (lower.includes('attack') || lower.includes('damage')) score += 7;
  
  // HP/health bonuses are very important
  if (lower.includes('hp') || lower.includes('health') || lower.includes('hit points')) score += 6;
  
  // Armor bonuses
  if (lower.includes('armor') || lower.includes('pierce') || lower.includes('melee armor')) score += 6;
  
  // Speed bonuses change matchups
  if (lower.includes('faster') || lower.includes('speed') || lower.includes('move')) score += 5;
  
  // Cost reductions are economically significant
  if (lower.includes('cheaper') || lower.includes('cost') || lower.includes('discount')) score += 5;
  
  // Range bonuses (very strong for archers)
  if (lower.includes('range') && !lower.includes('ranged')) score += 6;
  
  // Training speed
  if (lower.includes('train') || lower.includes('creation') || lower.includes('work rate')) score += 4;
  
  // Unit-specific keywords (indicate military bonuses)
  const unitKeywords = ['cavalry', 'archer', 'infantry', 'knight', 'scout', 
    'militia', 'spearman', 'eagle', 'camel', 'elephant', 'siege'];
  for (const keyword of unitKeywords) {
    if (lower.includes(keyword)) {
      score += 3;
      break;
    }
  }
  
  // Building keywords
  if (lower.includes('stable') || lower.includes('archery') || lower.includes('barracks')) score += 2;
  
  // Starting bonuses are weaker in late game
  if (lower.includes('starting')) score -= 3;
  
  // Team bonuses affect only team games
  if (lower.includes('team')) score -= 2;
  
  // Fishing/water bonuses less relevant on land
  if (lower.includes('fish') || lower.includes('galley') || lower.includes('dock')) score -= 4;
  
  return Math.max(0, score);
}

/**
 * Checks if a bonus is military-related
 * @param {string} bonus - Bonus text
 * @returns {boolean}
 */
function isMilitaryBonus(bonus) {
  const lower = bonus.toLowerCase();
  const militaryKeywords = [
    'attack', 'damage', 'hp', 'health', 'armor', 'speed', 'faster',
    'cost', 'cheaper', 'free', 'bonus', 'range', 'train', 
    'cavalry', 'archer', 'infantry', 'siege', 'monk', 'knight',
    'spearman', 'militia', 'scout', 'eagle', 'camel', 'elephant',
    'castle', 'unique', 'military', 'barracks', 'stable', 'archery',
    'blacksmith', 'upgrade'
  ];
  return militaryKeywords.some(keyword => lower.includes(keyword));
}

/**
 * Sorts bonuses by their military impact (strongest first)
 * @param {string[]} bonuses - Full list of bonuses
 * @returns {string[]} - Sorted bonuses (strongest first)
 */
function sortBonusesByStrength(bonuses) {
  return [...bonuses].sort((a, b) => scoreBonusStrength(b) - scoreBonusStrength(a));
}

/**
 * Extracts key military bonuses from the full bonus list
 * These are bonuses that directly affect army composition/strength
 * Returns sorted by strength (strongest first)
 * @param {string[]} bonuses - Full list of bonuses
 * @returns {string[]} - Key military bonuses, sorted by strength
 */
function extractKeyMilitaryBonuses(bonuses) {
  const keyBonuses = bonuses.filter(isMilitaryBonus);
  return sortBonusesByStrength(keyBonuses);
}

/**
 * Generates matchup data for one opponent civilization
 * @param {string} userCiv - User's civilization
 * @param {string} opponentCiv - Opponent civilization
 * @param {object} gameData - Full game data
 * @param {object} strings - Strings lookup
 * @param {string[]} userAvailableUnits - User's available first-tier units
 * @param {object} civHelps - Civ help text mapping
 * @returns {object} - Matchup data
 */
function generateMatchup(userCiv, opponentCiv, gameData, strings, userAvailableUnits, civHelps) {
  const { techtrees } = gameData;
  const units = gameData.data.units;
  const techs = gameData.data.techs;
  const unitUpgrades = gameData.data.unit_upgrades;
  
  // Get opponent data
  const opponentBonuses = extractCivBonuses(opponentCiv, civHelps, strings);
  const opponentUniqueUnits = getCivUniqueUnits(opponentCiv, techtrees, units, strings);
  const opponentUniqueTechs = getCivUniqueTechs(opponentCiv, techtrees, techs, strings);
  
  // Extract key military bonuses (emphasized)
  const keyMilitaryBonuses = extractKeyMilitaryBonuses(opponentBonuses);
  
  // Determine opponent's strong units based on their bonuses, civ type, and unique units
  const opponentStrengths = [];
  
  // Add unique unit as a strength
  if (opponentUniqueUnits.castle) {
    opponentStrengths.push({
      unit: opponentUniqueUnits.castle,
      type: 'UniqueUnit',
      reason: 'Unique Unit'
    });
  }
  
  // MESO CIVS: Always add Eagle Warrior as core strength
  if (MESO_CIVS.includes(opponentCiv)) {
    opponentStrengths.push({
      unit: 'Eagle Warrior',
      type: 'EagleWarrior',
      reason: 'Core unit (no cavalry available)'
    });
  }
  
  // CIV TYPE-BASED STRENGTHS
  if (CAVALRY_CIVS.includes(opponentCiv)) {
    opponentStrengths.push({
      unit: 'Knight',
      type: 'Cavalry',
      reason: 'Cavalry civilization'
    });
  }
  
  if (ARCHER_CIVS.includes(opponentCiv) && opponentCiv !== userCiv) {
    opponentStrengths.push({
      unit: 'Archer',
      type: 'Archer',
      reason: 'Archer civilization'
    });
  }
  
  if (INFANTRY_CIVS.includes(opponentCiv)) {
    opponentStrengths.push({
      unit: 'Militia',
      type: 'Infantry',
      reason: 'Infantry civilization'
    });
  }
  
  if (SIEGE_CIVS.includes(opponentCiv)) {
    opponentStrengths.push({
      unit: 'Mangonel',
      type: 'SiegeWeapon',
      reason: 'Siege civilization'
    });
  }
  
  if (MONK_CIVS.includes(opponentCiv)) {
    opponentStrengths.push({
      unit: 'Monk',
      type: 'Monk',
      reason: 'Strong monastery'
    });
  }
  
  if (GUNPOWDER_CIVS.includes(opponentCiv)) {
    opponentStrengths.push({
      unit: 'Hand Cannoneer',
      type: 'GunpowderUnit',
      reason: 'Gunpowder civilization'
    });
  }
  
  // BONUS-BASED ADDITIONAL STRENGTHS
  const bonusText = opponentBonuses.join(' ').toLowerCase();
  
  // Only add if not already covered by civ type
  if (!CAVALRY_CIVS.includes(opponentCiv)) {
    // Check for cavalry bonuses but EXCLUDE "cavalry archer" context
    // Use word boundary checks to avoid false positives like "Cavalry Archers" triggering Knight strength
    const hasCavalryBonus = (
      (bonusText.includes('cavalry') && !bonusText.includes('cavalry archer')) ||
      bonusText.includes('knight') ||
      (bonusText.includes('stable') && !bonusText.includes('unstable'))
    );
    if (hasCavalryBonus) {
      opponentStrengths.push({ unit: 'Knight', type: 'Cavalry', reason: 'Bonus-enhanced' });
    }
  }
  if (!ARCHER_CIVS.includes(opponentCiv)) {
    if (bonusText.includes('archer') && !bonusText.includes('cavalry archer')) {
      opponentStrengths.push({ unit: 'Archer', type: 'Archer', reason: 'Bonus-enhanced' });
    }
  }
  if (!INFANTRY_CIVS.includes(opponentCiv)) {
    if (bonusText.includes('infantry') || bonusText.includes('militia') || bonusText.includes('barracks')) {
      opponentStrengths.push({ unit: 'Militia', type: 'Infantry', reason: 'Bonus-enhanced' });
    }
  }
  
  // Get counters for each opponent strength, prioritized by user's civ bonuses
  const primaryCounters = []; // One counter per strength (best match for civ)
  const additionalCounters = []; // Extra counters
  const seenStrengths = new Set();
  const seen = new Set();
  
  for (const strength of opponentStrengths) {
    // Use civ-aware counter function for better prioritization
    const unitCounters = getCountersForCiv(strength.unit, userAvailableUnits, userCiv);
    let addedPrimary = false;
    
    for (const counter of unitCounters) {
      // counter has {unit, reason, civBonus} from getCountersForCiv
      const key = `${counter.unit}-${strength.unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      
      const counterObj = {
        use: counter.unit,
        against: strength.unit,
        reason: counter.civBonus ? `${counter.reason} (civ bonus!)` : counter.reason,
        civBonus: counter.civBonus
      };
      
      if (!addedPrimary && !seenStrengths.has(strength.unit)) {
        // First counter for this strength (already best due to sorting)
        primaryCounters.push(counterObj);
        seenStrengths.add(strength.unit);
        addedPrimary = true;
      } else {
        // Additional counter
        additionalCounters.push(counterObj);
      }
    }
  }
  
  // Combine: all primary counters (ensure every strength has one) + additional up to limit
  // Sort additional counters to prefer those with civ bonuses
  additionalCounters.sort((a, b) => (b.civBonus ? 1 : 0) - (a.civBonus ? 1 : 0));
  const MAX_ADDITIONAL = 3;
  const allCounters = [...primaryCounters, ...additionalCounters.slice(0, MAX_ADDITIONAL)];
  
  // Get timing windows with opponent strength context
  const timingWindows = getTimingWindows(userCiv, opponentCiv, opponentStrengths, opponentBonuses);
  
  return {
    difficulty: getMatchupDifficulty(userCiv, opponentCiv, opponentStrengths),
    opponentDescription: getCivDescription(opponentCiv),
    opponentPeakTiming: CIV_PEAK_TIMINGS[opponentCiv] || null,
    keyBonuses: keyMilitaryBonuses.slice(0, 3), // Top 3 KEY military bonuses (emphasized)
    allBonuses: sortBonusesByStrength(opponentBonuses), // Full bonus list sorted by strength
    opponentUniqueUnit: opponentUniqueUnits.castle,
    opponentUniqueUnitCategories: getUniqueUnitCategories(opponentUniqueUnits.castle),
    opponentStrengths: opponentStrengths.map(s => ({
      unit: s.unit,
      reason: s.reason
    })),
    counters: allCounters,
    timingWindows,
    strategy: generateStrategy(userCiv, opponentCiv, opponentStrengths)
  };
}

/**
 * Per-civilization strategies against different opponent types
 * @type {Object<string, {vs_cavalry: string, vs_archer: string, vs_infantry: string, vs_siege: string, vs_meso: string, vs_gunpowder: string, vs_monk: string, vs_spearman: string, default: string}>}
 */
const CIV_STRATEGIES = {
  'Britons': {
    vs_cavalry: 'Mass Crossbows with Spearman support. Use +1/+2 range to kite Knights. Keep Monks behind to convert expensive cavalry.',
    vs_archer: 'Archer mirror - your +1/+2 range wins fights. Add Skirmishers to trade efficiently. Get Longbowmen for max range.',
    vs_infantry: 'Archers destroy infantry. Keep distance and micro. Watch for siege support - have cavalry ready to snipe Mangonels.',
    vs_siege: 'DANGER: Siege counters archers. Keep Knights/Light Cav to snipe siege. Split archers to minimize Mangonel damage.',
    vs_meso: 'CRITICAL: Eagles counter archers in Imperial. Win early with Crossbow mass or add Champion/Knights. Avoid late game archer-only.',
    vs_gunpowder: 'Pressure early before Hand Cannoneers arrive. Your archers outrange them. Avoid prolonged Imperial Age fights.',
    vs_monk: 'Monks threaten your Knights. Use archers to kill Monks from range. Light Cavalry is cheap and hard to convert.',
    vs_spearman: 'ADVANTAGE: Archers destroy Spearmen easily. Kite with +1/+2 range bonus. Add Skirmishers for trash wars.',
    default: 'Standard Crossbow play in Castle Age. Get +1/+2 range bonus. Transition to Longbowmen. Control with range advantage.'
  },
  'Franks': {
    vs_cavalry: 'Knight fight - your +20% HP wins 1v1. Avoid Camels. Add throwing axes vs pike spam.',
    vs_archer: 'Knights close gap fast. Small wall to protect eco, then all-in Castle Age Knights. Archers melt to your cavalry.',
    vs_infantry: 'Knights destroy infantry. Use Throwing Axemen to add ranged damage. Avoid fighting into Halberdier masses.',
    vs_siege: 'Your Knights are perfect for sniping siege. Keep mobile, pick off Mangonels.',
    vs_meso: 'Knights are excellent vs Eagles early. Add Hand Cannoneers or Throwing Axemen for Imperial Eagle fights.',
    vs_gunpowder: 'Rush them in Castle Age before gunpowder arrives. Knights with Bloodlines are devastating early.',
    vs_monk: 'DANGER: Monks counter Knights. Use Light Cavalry to snipe Monks, or micro Knights in small groups.',
    vs_spearman: 'DANGER: Pikes counter your Knights. Use Throwing Axemen or Hand Cannoneers. Mix Light Cavalry to bait pikes.',
    default: 'Fast Castle into Knights. +20% HP wins most cavalry fights. Pressure before they mass counters.'
  },
  'Goths': {
    vs_cavalry: 'Survive until Imperial with Huskarls + Halberdiers. Spam infantry to overwhelm. Dont fight cavalry in Castle Age.',
    vs_archer: 'ADVANTAGE: Huskarls destroy archers. Rush Castle Age, get Huskarls, and close the game.',
    vs_infantry: 'Infantry vs infantry - your faster production wins. Champion spam with Perfusion is unstoppable.',
    vs_siege: 'Flood infantry around siege. Your numbers overwhelm - sacrifice units to kill siege.',
    vs_meso: 'Infantry vs Eagles - your Champion spam should win with Perfusion speed.',
    vs_gunpowder: 'Huskarls have high pierce armor vs Hand Cannoneers. Mix Champions for better melee.',
    vs_monk: 'Flood cheap infantry - too many to convert. Overwhelm with numbers.',
    vs_spearman: 'Your Champions beat Halberdiers. Use Huskarls to tank while Champions clean up. Spam overwhelms.',
    default: 'Survive to Imperial, then spam infantry with Perfusion. Huskarls vs archers, Champions vs everything else.'
  },
  'Mongols': {
    vs_cavalry: 'Mangudai kite cavalry. Add Camels or Pikemen. Your faster siege helps in late game.',
    vs_archer: 'Mangudai beat archers in mobility. Add Hussars to raid and distract. Drill Siege Rams end games.',
    vs_infantry: 'Mangudai destroy infantry. Hit-and-run tactics. Use siege for pushes.',
    vs_siege: 'Mangudai bonus vs siege is devastating. Snipe Mangonels, then clean up.',
    vs_meso: 'Mangudai beat Eagles with micro. Add Champions or siege for backup.',
    vs_gunpowder: 'Mangudai outrange and kite gunpowder. Drill siege for pushing.',
    vs_monk: 'Mangudai kill Monks easily. Stay mobile, dont let them convert.',
    vs_spearman: 'Mangudai kite Spearmen easily. Use Hussars to raid around pike masses. Drill Siege crushes pike balls.',
    default: 'Hunt bonus for fast Feudal/Castle. Mangudai hit-and-run. Drill Siege Onagers for late game.'
  },
  'Chinese': {
    vs_cavalry: 'Chu Ko Nu with Pikemen support. Tech discount helps you upgrade faster.',
    vs_archer: 'Chu Ko Nu high DPS wins archer fights. Add Scorpions for mass archer battles.',
    vs_infantry: 'Chu Ko Nu destroy infantry. Keep distance and focus fire.',
    vs_siege: 'Chu Ko Nu are fragile vs siege. Add Light Cav to snipe Mangonels.',
    vs_meso: 'Chu Ko Nu beat Eagles early. Add Champions for Imperial Eagle fights.',
    vs_gunpowder: 'Tech discount lets you reach Imperial faster. Rocketry Scorpions are strong late.',
    vs_monk: 'Chu Ko Nu kill Monks from range. Keep your distance.',
    vs_spearman: 'Chu Ko Nu shred Spearmen with rapid fire. Tech discount helps you upgrade archers faster.',
    default: 'Tech discount compounds over time. Chu Ko Nu mass in Castle. Rocketry Scorpions late game.'
  },
  'Vikings': {
    vs_cavalry: 'Pikemen + Archers. Berserks can fight cavalry with support. Economy advantage helps you outproduce.',
    vs_archer: 'Berserks close gap, regenerate between fights. Add Skirmishers for archer wars.',
    vs_infantry: 'Berserks with regeneration win attrition wars. Chieftains bonus vs cavalry helps.',
    vs_siege: 'Berserks or cavalry to snipe siege. Your economy lets you replace losses.',
    vs_meso: 'Berserks vs Eagles. Chieftains gives anti-cavalry bonus. Champions work too.',
    vs_gunpowder: 'Pressure early with economy lead. Berserks or archers before gunpowder mass.',
    vs_monk: 'Berserks regenerate conversion damage. Overwhelm with numbers.',
    vs_spearman: 'Archers destroy Spearmen. Economy advantage lets you mass archers. Berserks can fight pikes if needed.',
    default: 'Wheelbarrow/Hand Cart free - use economy lead. Berserks in Castle, Chieftains Champions late.'
  },
  'Japanese': {
    vs_cavalry: '33% faster attacking infantry shreds cavalry. Add Pikemen, micro Samurai vs unique cavalry.',
    vs_archer: 'Close with fast-attacking infantry. Samurai are decent, add siege support.',
    vs_infantry: 'ADVANTAGE: Your infantry attacks 33% faster. Samurai bonus vs unique units.',
    vs_siege: 'Use fast infantry to reach siege. Trebs with Kataparuto pack/unpack fast.',
    vs_meso: 'Samurai vs Eagles. Your attack speed wins infantry fights.',
    vs_gunpowder: 'Close fast with infantry. Use Yasama towers for defense.',
    vs_monk: 'Fast attacking infantry kills Monks quickly. Dont let them convert.',
    vs_spearman: 'Your faster-attacking Champions beat Halberdiers. Samurai with attack speed shred pike lines.',
    default: 'Feudal MAA pressure with attack speed. Samurai vs unique units. Yasama towers + Trebs for siege.'
  },
  'Byzantines': {
    vs_cavalry: 'Cheap Camels hard counter cavalry. Add Cataphracts for anti-pike cavalry.',
    vs_archer: 'Cataphracts or cheap Skirms. Counter their archers cost-effectively.',
    vs_infantry: 'Cataphracts trample infantry. Add archers for ranged support.',
    vs_siege: 'Cataphracts or cheap Hussars to snipe siege. Your cheap trash helps.',
    vs_meso: 'Cataphracts destroy Eagles. Logistica splash damage is devastating.',
    vs_gunpowder: 'Cataphracts close fast. Cheap skirms and hussars for trading.',
    vs_monk: 'Cheap Hussars are hard to convert profitably. Swarm Monks.',
    vs_spearman: 'ADVANTAGE: Cataphracts ignore pike bonus damage! Logistica splash destroys pike masses. Perfect counter.',
    default: 'Counter civ - adapt to opponent. Cheap trash for late game. Cataphracts vs infantry civs.'
  },
  'Aztecs': {
    vs_cavalry: 'Monks + Eagles. Convert expensive cavalry. Jaguar Warriors vs infantry support.',
    vs_archer: 'Eagles close gap fast. Add Monks for conversions. Siege support for archer balls.',
    vs_infantry: 'ADVANTAGE: Jaguar Warriors destroy infantry. +4 bonus damage is massive.',
    vs_siege: 'Eagles snipe siege quickly. Keep mobile.',
    vs_meso: 'Jaguar Warriors vs Eagles. Your military creation speed helps mass faster.',
    vs_gunpowder: 'Eagles + Monks before gunpowder. Faster military production helps rush.',
    vs_monk: 'Your Monks are also strong. Monk war + Eagles.',
    vs_spearman: 'Jaguar Warriors destroy Spearmen with anti-infantry bonus. Eagles also beat pikes. Overwhelm with production speed.',
    default: 'Faster military creation. Eagles + Monks in Castle. Garland Wars Eagles (+4 attack) in Imperial.'
  },
  'Mayans': {
    vs_cavalry: 'Plumed Archers kite cavalry. Add cheap Eagles or Pikemen.',
    vs_archer: 'Plumed Archers have high pierce armor - win archer fights. Obsidian Arrows helps.',
    vs_infantry: 'Archers destroy infantry. Plumed Archers kite safely.',
    vs_siege: 'Plumed Archers are mobile but fragile vs siege. Add Eagles to snipe.',
    vs_meso: 'Plumed Archers + Eagles. Your longer lasting resources give economy edge.',
    vs_gunpowder: 'Pressure before Imperial. Plumed Archers + Eagles to overwhelm.',
    vs_monk: 'Plumed Archers kill Monks from range. Eagles are cheap to replace if converted.',
    vs_spearman: 'Plumed Archers destroy Spearmen. El Dorado Eagles can fight through pikes if needed.',
    default: 'Resources last longer - boom hard. Plumed Archers + El Dorado Eagles (+40 HP).'
  },
  'Turks': {
    vs_cavalry: 'Janissaries + Spearmen. Free Chemistry helps gunpowder early.',
    vs_archer: 'Janissaries destroy archers. Sipahi Cavalry Archers are tanky.',
    vs_infantry: 'Janissaries shred infantry. No minimum range helps.',
    vs_siege: 'Bombard Cannons snipe siege. Artillery gives +2 range.',
    vs_meso: 'Janissaries destroy Eagles. Hand Cannoneers are even better.',
    vs_gunpowder: 'Your gunpowder is better - free Chemistry, Artillery. Win gunpowder fight.',
    vs_monk: 'Janissaries kill Monks from range. Keep distance.',
    vs_spearman: 'Janissaries and Hand Cannoneers shred Spearmen. +10 bonus damage vs infantry. Use Sipahi CA for mobility.',
    default: 'Free Chemistry = Castle Age Janissaries. Boom into Imperial gunpowder + Artillery BBCs.'
  },
  'Persians': {
    vs_cavalry: 'Your Knights are strong. Add Camels vs Paladins. War Elephants late.',
    vs_archer: 'Knights close gap. TC bonus helps boom into more Knights.',
    vs_infantry: 'Cavalry destroys infantry. War Elephants are unstoppable vs pure infantry.',
    vs_siege: 'Knights snipe siege. War Elephants tank siege damage.',
    vs_meso: 'Knights vs Eagles. War Elephants in Imperial crush everything.',
    vs_gunpowder: 'Knights before gunpowder. War Elephants tank gunpowder.',
    vs_monk: 'DANGER: War Elephants are conversion targets. Use Knights instead, or overwhelm Monks.',
    vs_spearman: 'War Elephants can tank pike damage with massive HP. Add Trashbows or Hand Cannoneers to kill pikes.',
    default: 'TC bonus for fast Castle. Knights in Castle Age. War Elephants with Mahouts late game.'
  },
  'Huns': {
    vs_cavalry: 'Cavalry Archers kite cavalry. Tarkans raid buildings. Add Paladins for fights.',
    vs_archer: 'Cavalry Archers with Paladins. Your CA have more HP. No house bonus helps early.',
    vs_infantry: 'Cavalry Archers destroy infantry. Tarkans raid their production.',
    vs_siege: 'Cavalry Archers are mobile but fragile vs siege. Tarkans can tank siege.',
    vs_meso: 'Cavalry Archers + Paladins. Tarkans raid to disrupt economy.',
    vs_gunpowder: 'Aggression before Imperial. No house bonus helps early pressure.',
    vs_monk: 'Tarkans are cheap to lose if converted. Cavalry Archers kill Monks from range.',
    vs_spearman: 'Cavalry Archers kite Spearmen easily. Tarkans have high pierce armor vs archer support. Stay mobile.',
    default: 'No houses = faster start. Cavalry Archers + Paladins. Tarkans for raiding buildings.'
  },
  // Western European
  'Celts': {
    vs_cavalry: 'Woad Raiders are fast enough to catch cavalry. Add Pikemen. Your faster infantry closes gap.',
    vs_archer: 'Woad Raiders close gap fast with speed bonus. Add Siege Onagers with Furor Celtica.',
    vs_infantry: 'Your infantry is 15% faster. Woad Raiders outmaneuver enemy infantry. Siege support.',
    vs_siege: 'Your siege is better! Siege Onagers with Furor Celtica. Woad Raiders snipe enemy siege.',
    vs_meso: 'Woad Raiders vs Eagles - speed helps. Add Siege Onagers for area damage.',
    vs_gunpowder: 'Rush before Imperial. Woad Raiders close distance quickly. Siege Onagers outrange HC.',
    vs_monk: 'Woad Raiders are too fast for Monks. Raid before they can convert.',
    vs_spearman: 'Siege Onagers destroy pike masses. Woad Raiders can kite Spearmen with speed advantage.',
    default: 'Fast infantry with Woad Raiders. Furor Celtica Siege Onagers for late game. Pressure early with speed.'
  },
  'Teutons': {
    vs_cavalry: 'Your Knights have +2 melee armor. Teutonic Knights destroy cavalry in melee. Add Monks.',
    vs_archer: 'Push with siege + Teutonic Knights. Ironclad siege tanks arrows. Close distance slowly.',
    vs_infantry: 'ADVANTAGE: Teutonic Knights have highest melee armor. Win any infantry fight.',
    vs_siege: 'Your siege has more armor. Teutonic Knights tank while siege duels.',
    vs_meso: 'Teutonic Knights destroy Eagles. Slow push with siege support.',
    vs_gunpowder: 'Push with siege. Teutonic Knights tank HC fire with high armor.',
    vs_monk: 'ADVANTAGE: Your Monks have +4 range. Convert their units first. Monastery bonus.',
    vs_spearman: 'Teutonic Knights have so much armor, pike bonus is reduced. Slow push through pikes.',
    default: 'Slow push civ. Teutonic Knights + siege deathball. Monks with extra range. Crenellations Castles.'
  },
  'Spanish': {
    vs_cavalry: 'Conquistadors kite cavalry. Add Monks with Inquisition for fast conversions.',
    vs_archer: 'Conquistadors beat archers. Missionaries are mobile monks for conversions.',
    vs_infantry: 'Conquistadors shred infantry. No minimum range on gunpowder helps.',
    vs_siege: 'Conquistadors are mobile vs siege. Bombard Cannons in Imperial.',
    vs_meso: 'Conquistadors destroy Eagles. Hand Cannoneers with faster fire rate.',
    vs_gunpowder: 'Your gunpowder fires 18% faster. Win gunpowder duels.',
    vs_monk: 'Missionaries are mobile. Inquisition gives fast conversions. Monk vs Monk.',
    vs_spearman: 'Conquistadors destroy Spearmen. 18% faster firing gunpowder shreds infantry.',
    default: 'Conquistadors in Castle Age. Faster firing gunpowder in Imperial. Missionaries for mobile conversions.'
  },
  'Portuguese': {
    vs_cavalry: 'Organ Guns + Pikemen. Gold discount helps sustain gunpowder.',
    vs_archer: 'Organ Guns area damage vs archer masses. Gold discount on all units.',
    vs_infantry: 'Organ Guns shred infantry. Arquebus makes gunpowder accurate.',
    vs_siege: 'Bombard Cannons with Arquebus are accurate. Snipe enemy siege.',
    vs_meso: 'Organ Guns destroy Eagles. Hand Cannoneers with gold discount.',
    vs_gunpowder: 'Arquebus gives ballistics to gunpowder. More accurate than opponent.',
    vs_monk: 'Organ Guns kill Monks from range. Stay at distance.',
    vs_spearman: 'Organ Guns have area damage. Perfect vs pike masses. Gold discount sustains production.',
    default: 'Gold discount on all units. Organ Guns in Castle. Feitoria for infinite resources late game.'
  },
  'Italians': {
    vs_cavalry: 'Genoese Crossbowmen destroy cavalry! +6 bonus damage. Perfect counter.',
    vs_archer: 'Cheaper age-up lets you reach upgrades faster. Add Pavise Crossbows.',
    vs_infantry: 'Genoese Crossbowmen kite infantry. Cheaper age-up advantage.',
    vs_siege: 'Genoese Crossbowmen fragile vs siege. Add Hussars to snipe.',
    vs_meso: 'Genoese Crossbowmen beat Eagles. Condottiero vs gunpowder civs.',
    vs_gunpowder: 'ADVANTAGE: Condottiero has +10 bonus vs gunpowder. Perfect counter unit.',
    vs_monk: 'Genoese Crossbowmen outrange Monks. Keep distance.',
    vs_spearman: 'Genoese Crossbowmen destroy all infantry including pikes. Kite with range.',
    default: 'Cheap age-up timing. Genoese Crossbowmen vs cavalry civs. Condottiero vs gunpowder.'
  },
  'Sicilians': {
    vs_cavalry: 'Your Cavaliers take 50% less bonus damage. Hauberk gives +1/+2 armor. Fight cavalry.',
    vs_archer: 'Serjeants tank arrows. Donjons for forward pressure. 50% less bonus damage.',
    vs_infantry: 'Serjeants are tanky infantry. 50% less bonus damage makes you resilient.',
    vs_siege: 'Cavaliers snipe siege. Your units resist bonus damage from siege.',
    vs_meso: 'Cavaliers beat Eagles. 50% less bonus damage applies to anti-cav too.',
    vs_gunpowder: 'Serjeants tank gunpowder. 50% less bonus damage helps vs HC.',
    vs_monk: 'First Crusade gives Serjeant spam. Overwhelm Monks with numbers.',
    vs_spearman: 'ADVANTAGE: 50% less bonus damage means pikes do half their bonus. Your cavalry survives!',
    default: '50% less bonus damage is huge. Hauberk Cavaliers. Donjon rush with Serjeants.'
  },
  'Burgundians': {
    vs_cavalry: 'Early Cavalier timing! Research one age earlier. Win cavalry fights.',
    vs_archer: 'Early Cavalier closes gap. Economic upgrades one age earlier helps.',
    vs_infantry: 'Cavaliers destroy infantry. Coustillier charge attack is devastating.',
    vs_siege: 'Cavaliers snipe siege. Coustillier charge one-shots siege.',
    vs_meso: 'Cavaliers beat Eagles. Coustillier charge is powerful.',
    vs_gunpowder: 'Early Cavalier timing rushes before gunpowder. Vineyards for gold.',
    vs_monk: 'Coustillier charge and retreat. Micro to avoid conversion.',
    vs_spearman: 'Coustillier charge kills pikes before they attack. Hit-and-run with charge cooldown.',
    default: 'Economic upgrades one age earlier. Castle Age Cavalier timing. Coustillier charge attacks.'
  },
  // Eastern European
  'Slavs': {
    vs_cavalry: 'Boyars have high melee armor. Add Pikemen. Druzhina splash helps.',
    vs_archer: 'Boyars tank arrows. Siege push with faster farming economy.',
    vs_infantry: 'ADVANTAGE: Druzhina Champions have splash damage. Destroy infantry blobs.',
    vs_siege: 'Boyars or Hussars snipe siege. Your siege is also strong.',
    vs_meso: 'Druzhina Champions splash Eagles. Boyars work too.',
    vs_gunpowder: 'Boyars tank HC. Push with siege before Imperial.',
    vs_monk: 'Flood cheap Hussars. Druzhina Champions overwhelm.',
    vs_spearman: 'Druzhina splash damage destroys pike formations. Champions beat Halberdiers.',
    default: 'Faster farming economy. Boyars for cavalry. Druzhina Champions for splash damage.'
  },
  'Magyars': {
    vs_cavalry: 'Free forging helps Scout rush. Magyar Huszar bonus vs siege. Recurve Bow CA.',
    vs_archer: 'Magyar Huszar raids. Recurve Bow Cavalry Archers have +1 range.',
    vs_infantry: 'Cavalry Archers destroy infantry. Magyar Huszar raids production.',
    vs_siege: 'ADVANTAGE: Magyar Huszar has bonus vs siege. Snipe Mangonels easily.',
    vs_meso: 'Magyar Huszar + Cavalry Archers. Free attack upgrades save gold.',
    vs_gunpowder: 'Aggressive Scout rush before Imperial. Cavalry Archers kite.',
    vs_monk: 'Magyar Huszar is cheap. Cavalry Archers kill Monks from range.',
    vs_spearman: 'Recurve Bow Cavalry Archers kite pikes. Magyar Huszar raids around.',
    default: 'Free forging Scout rush. Free attack upgrades. Magyar Huszar vs siege. Recurve Bow CA.'
  },
  'Bulgarians': {
    vs_cavalry: 'Stirrups Cavaliers attack 33% faster. Win cavalry fights. Konnik dismounts.',
    vs_archer: 'Stirrups Knights close gap fast. Krepost forward pressure.',
    vs_infantry: 'Stirrups cavalry shreds infantry. Konnik gives extra value on death.',
    vs_siege: 'Stirrups cavalry snipes siege quickly. Krepost provides map control.',
    vs_meso: 'Stirrups Cavaliers beat Eagles. Konniks dismount as infantry.',
    vs_gunpowder: 'Rush before Imperial. Stirrups cavalry attacks fast.',
    vs_monk: 'Konniks dismount if converted - less value lost. Overwhelm.',
    vs_spearman: 'Two-Handed Swordsmen are free upgrade. Champions beat pikes. Stirrups cavalry can fight through.',
    default: 'Cheap Blacksmith upgrades. Krepost + Konniks. Stirrups 33% faster attacking cavalry.'
  },
  'Bohemians': {
    vs_cavalry: 'Hussite Wagons + Pikemen. Wagons protect archers from cavalry.',
    vs_archer: 'Hussite Wagons counter archers. Hand Cannoneers with Houfnice.',
    vs_infantry: 'Hussite Wagons + Hand Cannoneers shred infantry.',
    vs_siege: 'ADVANTAGE: Houfnice is better Bombard Cannon. Win siege duels.',
    vs_meso: 'Hand Cannoneers destroy Eagles. Hussite Wagons provide protection.',
    vs_gunpowder: 'Houfnice outranges enemy BBCs. Chemistry free helps.',
    vs_monk: 'Hussite Reforms - Monks cost no gold! Monk war advantage.',
    vs_spearman: 'Hussite Wagons area damage vs pikes. Hand Cannoneers +10 vs infantry.',
    default: 'Hussite Wagons protect archers. Houfnice for siege. Hussite Reforms for gold-free Monks.'
  },
  'Poles': {
    vs_cavalry: 'Cheap Cavaliers fight cavalry. Obuch strips armor for follow-up.',
    vs_archer: 'Cheap cavalry closes gap. Folwark farming boosts economy.',
    vs_infantry: 'Obuch removes armor permanently. Winged Hussars trample.',
    vs_siege: 'Cheap Cavaliers snipe siege. Winged Hussars in Imperial.',
    vs_meso: 'Cheap Cavaliers beat Eagles. Winged Hussars trample.',
    vs_gunpowder: 'Rush with cheap cavalry before Imperial. Folwark economy.',
    vs_monk: 'Flood cheap cavalry. Too many to convert profitably.',
    vs_spearman: 'Obuch removes pike armor. Archers clean up armorless pikes easily.',
    default: 'Folwark farming bonus. Cheap Cavaliers. Obuch armor stripping. Szlachta Privileges.'
  },
  'Lithuanians': {
    vs_cavalry: 'Leitis ignores armor! Destroys Paladins. Collect relics for +attack.',
    vs_archer: 'Collect relics for +attack. Leitis or Paladins close gap.',
    vs_infantry: 'Leitis ignores armor. +attack from relics makes you deadly.',
    vs_siege: 'Leitis or Winged Hussar snipes siege. Relic bonus applies.',
    vs_meso: 'Leitis destroys Eagles. Relic attack bonus stacks.',
    vs_gunpowder: 'Rush to collect relics. Leitis closes gap fast.',
    vs_monk: 'DANGER: Losing units loses relic investment. Micro carefully.',
    vs_spearman: 'Leitis ignores pike armor! Just raw damage. 4 relics = +4 attack.',
    default: 'Collect relics for +1/+2/+3/+4 attack. Leitis ignores armor. Winged Hussars.'
  },
  // Middle Eastern
  'Saracens': {
    vs_cavalry: 'Mamelukes counter cavalry with ranged attack. Camels available too.',
    vs_archer: 'Market bonus helps eco. Mamelukes are mobile vs archers.',
    vs_infantry: 'Mamelukes kite infantry. Archers with Zealotry tanky.',
    vs_siege: 'Mamelukes mobile enough to snipe siege. Bombard Cannons available.',
    vs_meso: 'Mamelukes beat Eagles. Archers work early.',
    vs_gunpowder: 'Market abuse for eco. Mamelukes outmicro gunpowder.',
    vs_monk: 'Mamelukes kill Monks with ranged attack. Stay mobile.',
    vs_spearman: 'Mamelukes are ranged - pikes cant catch them. Kite pike balls easily.',
    default: 'Market bonus for flexible eco. Mamelukes in Castle. Zealotry for tanky Camels.'
  },
  'Berbers': {
    vs_cavalry: 'Cheap Cavaliers fight cavalry. Camel Archers counter Cavalry Archers.',
    vs_archer: 'Camel Archers beat archers. 15-20% cheaper cavalry.',
    vs_infantry: 'Cheap cavalry destroys infantry. Genitours as trash ranged.',
    vs_siege: 'Cheap cavalry snipes siege. Camel Archers mobile.',
    vs_meso: 'Cheap Cavaliers beat Eagles. Camel Archers kite.',
    vs_gunpowder: 'Rush with cheap cavalry before Imperial. Aggression.',
    vs_monk: 'Flood cheap cavalry. Too many to convert.',
    vs_spearman: 'Camel Archers kite Spearmen. Genitours as ranged trash.',
    default: 'Cheap Stable units (15-20% discount). Camel Archers. Genitours as trash.'
  },
  'Hindustanis': {
    vs_cavalry: 'ADVANTAGE: Imperial Camel destroys all cavalry. Best anti-cav in game.',
    vs_archer: 'Ghulam bonus vs archers. Shatagni Hand Cannoneers +2 range.',
    vs_infantry: 'Hand Cannoneers shred infantry. Ghulam pass-through damage.',
    vs_siege: 'Imperial Camel snipes siege. Bombard Cannons available.',
    vs_meso: 'Hand Cannoneers destroy Eagles. Ghulam works too.',
    vs_gunpowder: 'Shatagni gives +2 range on HC. Win gunpowder fights.',
    vs_monk: 'Ghulam or cheap Hussars. Imperial Camel expensive to convert.',
    vs_spearman: 'Ghulam destroys Spearmen with pass-through. Hand Cannoneers +10 vs infantry.',
    default: 'Imperial Camel vs cavalry civs. Shatagni Hand Cannoneers. Ghulam vs archers.'
  },
  // Asian
  'Koreans': {
    vs_cavalry: 'War Wagons tank cavalry. Add Halberdiers. Tower rush early.',
    vs_archer: 'War Wagons have high HP and pierce armor. Win archer fights.',
    vs_infantry: 'War Wagons kite infantry. Shinkichon Onagers +1 range.',
    vs_siege: 'Shinkichon Onagers outrange enemy siege. War Wagons mobile.',
    vs_meso: 'War Wagons beat Eagles. Tower rush disrupts.',
    vs_gunpowder: 'War Wagons tank HC. Shinkichon siege pushes.',
    vs_monk: 'War Wagons expensive to convert. Keep distance.',
    vs_spearman: 'War Wagons destroy Spearmen. Shinkichon Onagers area damage.',
    default: 'Tower rush potential. War Wagons in Castle. Shinkichon Onagers +1 range.'
  },
  'Vietnamese': {
    vs_cavalry: 'Rattan Archers kite cavalry. Chatras Battle Elephants late.',
    vs_archer: 'ADVANTAGE: Rattan Archers have high pierce armor. Win archer fights.',
    vs_infantry: 'Rattan Archers destroy infantry. Extra HP on archers.',
    vs_siege: 'Rattan Archers fragile vs siege. Add cavalry to snipe.',
    vs_meso: 'Rattan Archers beat Eagles. Extra HP helps.',
    vs_gunpowder: 'Rattan Archers high pierce armor tanks HC damage.',
    vs_monk: 'Rattan Archers kill Monks from range. Stay back.',
    vs_spearman: 'Rattan Archers destroy Spearmen easily. Extra HP lets them fight longer.',
    default: 'Reveal enemy TC at start. Extra HP archers. Rattan Archers high pierce armor.'
  },
  'Burmese': {
    vs_cavalry: 'Manipur Cavalry gives +6 vs archers. Elephants available.',
    vs_archer: 'ADVANTAGE: Manipur Cavalry +6 vs archers. Arambai devastating.',
    vs_infantry: 'Arambai destroy infantry. +1 attack per age on infantry.',
    vs_siege: 'Arambai mobile vs siege. Elephants tank.',
    vs_meso: 'Arambai shred Eagles. Manipur Cavalry bonus.',
    vs_gunpowder: 'Rush with Arambai before Imperial. Aggression.',
    vs_monk: 'DANGER: Elephants vulnerable. Use Arambai from range.',
    vs_spearman: 'Arambai destroy Spearmen with ranged attack. Stay mobile.',
    default: 'Free lumber upgrades. Arambai raids. Manipur Cavalry vs archers. Howdah elephants.'
  },
  'Khmer': {
    vs_cavalry: 'Ballista Elephants shred cavalry. No building requirements fast Castle.',
    vs_archer: 'Ballista Elephants tank arrows. Scorpions with Double Crossbow.',
    vs_infantry: 'Ballista Elephants pass-through kills infantry lines.',
    vs_siege: 'Ballista Elephants or Hussars snipe siege. Fast Castle timing.',
    vs_meso: 'Ballista Elephants destroy Eagles. Scorpions work too.',
    vs_gunpowder: 'Fast Castle rushes before Imperial. Ballista Elephants tank.',
    vs_monk: 'DANGER: Elephants vulnerable to conversion. Add Light Cav.',
    vs_spearman: 'Scorpions with Double Crossbow destroy pike masses. Pass-through damage.',
    default: 'No building requirements for age-up. Fast Castle. Ballista Elephants. Double Crossbow Scorpions.'
  },
  'Malay': {
    vs_cavalry: 'Cheap Battle Elephants! 30% cheaper. Forced Levy 2HS for trash.',
    vs_archer: '66% faster age-up. Reach Castle Age early. Karambit swarm.',
    vs_infantry: 'Karambit Warriors half pop. Swarm tactics. Forced Levy.',
    vs_siege: 'Fast age-up timing. Cheap elephants tank siege.',
    vs_meso: 'Karambit swarm vs Eagles. Cheap elephants work.',
    vs_gunpowder: 'Fast age-up rushes before Imperial. Aggression.',
    vs_monk: 'DANGER: Cheap elephants still vulnerable. Use Karambit swarm instead.',
    vs_spearman: 'Forced Levy 2HS cost no gold. Trash swordsmen beat pikes.',
    default: '66% faster age-up. Cheap Battle Elephants. Forced Levy gold-free 2HS. Karambit half pop.'
  },
  'Dravidians': {
    vs_cavalry: 'Urumi Swordsmen with Wootz Steel ignore armor. Medical Corps heals.',
    vs_archer: 'Elephant Archers tank arrows. Urumi charge attack.',
    vs_infantry: 'ADVANTAGE: Wootz Steel ignores armor. Destroy any infantry.',
    vs_siege: 'Urumi or cavalry snipe siege. Elephant Archers tank.',
    vs_meso: 'Wootz Steel infantry destroys Eagles. Urumi charge.',
    vs_gunpowder: 'Urumi charge closes gap. Wootz Steel ignores armor.',
    vs_monk: 'DANGER: Elephants vulnerable. Use Urumi with charge.',
    vs_spearman: 'Wootz Steel ignores pike armor. Your infantry wins.',
    default: 'Wood bonus early. Urumi Swordsmen charge attack. Wootz Steel ignores all armor.'
  },
  'Bengalis': {
    vs_cavalry: 'Rathas switch melee/ranged. Elephants resist conversion.',
    vs_archer: 'Rathas ranged mode. Elephant Archers tank.',
    vs_infantry: 'Rathas destroy infantry. Paiks attack speed bonus.',
    vs_siege: 'Rathas switch to melee to snipe siege. Mobile.',
    vs_meso: 'Rathas beat Eagles. Switch modes as needed.',
    vs_gunpowder: 'Rathas versatile. Elephant Archers tank HC.',
    vs_monk: 'ADVANTAGE: Elephants resist conversion! 50% resistance.',
    vs_spearman: 'Rathas ranged mode kites pikes. Elephant Archers work too.',
    default: 'Rathas switch melee/ranged. Elephants resist conversion. Paiks attack speed.'
  },
  'Gurjaras': {
    vs_cavalry: 'Shrivamsha Riders dodge projectiles. Camels with bonus damage.',
    vs_archer: 'ADVANTAGE: Shrivamsha Riders dodge arrows! Counter archers hard.',
    vs_infantry: 'Chakram Throwers ranged infantry. Shrivamsha raids.',
    vs_siege: 'Shrivamsha Riders snipe siege. Camels available.',
    vs_meso: 'Shrivamsha + Chakram Throwers. Camels work vs Eagles.',
    vs_gunpowder: 'Shrivamsha dodge helps vs HC. Rush before Imperial.',
    vs_monk: 'Shrivamsha cheap to lose. Overwhelm Monks.',
    vs_spearman: 'Chakram Throwers destroy Spearmen. Ranged attack ignores pikes.',
    default: 'Mill bonus food. Shrivamsha dodge projectiles. Chakram Throwers. Frontier Guards Camels.'
  },
  // Central Asian
  'Cumans': {
    vs_cavalry: 'Steppe Lancers or Paladins. Feudal TC boom for eco lead.',
    vs_archer: 'Kipchaks fast firing CA. Feudal TC eco advantage.',
    vs_infantry: 'Kipchaks destroy infantry. Steppe Lancers mobile.',
    vs_siege: 'Steppe Lancers or Hussars snipe siege. Kipchaks kite.',
    vs_meso: 'Kipchaks + Paladins. Cuman Mercenaries in team games.',
    vs_gunpowder: 'Feudal TC boom, then rush Castle Age. Aggression.',
    vs_monk: 'Steppe Lancers cheap. Kipchaks kill Monks from range.',
    vs_spearman: 'Kipchaks kite Spearmen. Steppe Husbandry speed helps.',
    default: 'Feudal 2nd TC unique boom. Kipchaks fast firing. Steppe Lancers. Cuman Mercenaries.'
  },
  'Tatars': {
    vs_cavalry: 'Keshiks generate gold when attacking. Hill bonus fights.',
    vs_archer: 'Silk Armor Cavalry Archers tanky. Hill bonus helps.',
    vs_infantry: 'Cavalry Archers destroy infantry. Keshiks sustainable.',
    vs_siege: 'Cavalry Archers kite siege. Keshiks snipe.',
    vs_meso: 'Cavalry Archers + Keshiks. Hill bonus in fights.',
    vs_gunpowder: 'Rush before Imperial. Cavalry Archers kite.',
    vs_monk: 'Keshiks cheap enough to lose. CA kill Monks from range.',
    vs_spearman: 'Silk Armor CA kite pikes. Keshiks can fight through with gold generation.',
    default: 'Extra sheep early. Hill bonus +25% damage. Keshiks generate gold. Silk Armor CA.'
  },
  // African
  'Ethiopians': {
    vs_cavalry: 'Free Pikemen upgrade. 18% faster firing archers. Shotel Warriors raid.',
    vs_archer: 'ADVANTAGE: 18% faster firing archers. Win archer fights with DPS.',
    vs_infantry: 'Archers destroy infantry. Faster firing wins.',
    vs_siege: 'Torsion Engines siege has blast radius. Shotel Warriors snipe.',
    vs_meso: 'Faster firing archers beat Eagles early. Free Pikemen.',
    vs_gunpowder: 'Rush with fast firing archers. Pressure before Imperial.',
    vs_monk: 'Fast firing archers kill Monks quickly. Stay at range.',
    vs_spearman: '18% faster firing archers shred Spearmen. Royal Heirs bonus.',
    default: 'Free Pikemen upgrade. 18% faster firing archers. Torsion Engines siege. Shotel Warriors.'
  },
  'Malians': {
    vs_cavalry: 'Farimba Cavaliers +5 attack. Camels available.',
    vs_archer: 'ADVANTAGE: Infantry has +3 pierce armor. Gbeto ranged infantry.',
    vs_infantry: 'Gbeto throws axes. Farimba Cavaliers destroy infantry.',
    vs_siege: 'Farimba Cavaliers snipe siege. Gbeto mobile.',
    vs_meso: 'Pierce armor infantry fights Eagles. Gbeto works.',
    vs_gunpowder: 'Pierce armor helps vs HC. Rush before Imperial.',
    vs_monk: 'Cheap Hussars. Gbeto kills Monks from range.',
    vs_spearman: 'Gbeto ranged attack destroys pikes. Farimba Cavaliers can fight through.',
    default: 'Wood bonus economy. Pierce armor infantry. Farimba +5 attack cavalry. Gbeto raids.'
  },
  // American
  'Incas': {
    vs_cavalry: 'ADVANTAGE: Kamayuks have range vs cavalry. Destroy Knights.',
    vs_archer: 'Eagles close gap. Slingers bonus vs infantry helps. Fabric Shields.',
    vs_infantry: 'Slingers have +10 bonus vs infantry. Perfect counter.',
    vs_siege: 'Eagles snipe siege quickly. Kamayuks push.',
    vs_meso: 'Slingers destroy Eagles with +10 bonus. Also Kamayuks.',
    vs_gunpowder: 'Eagles rush before Imperial. Fabric Shields armor.',
    vs_monk: 'Eagles cheap to lose. Villagers have blacksmith upgrades.',
    vs_spearman: 'Slingers destroy Spearmen. +10 bonus vs infantry shreds pikes.',
    default: 'Villagers benefit from blacksmith. Kamayuks vs cavalry. Slingers vs infantry. Fabric Shields Eagles.'
  },
  // Caucasus
  'Georgians': {
    vs_cavalry: 'Monaspas get stronger in groups. Regenerating cavalry.',
    vs_archer: 'Monaspas close gap. Fortification bonuses help defense.',
    vs_infantry: 'Monaspas destroy infantry. Group bonus stacks.',
    vs_siege: 'Monaspas or Hussars snipe siege. Defensive bonuses.',
    vs_meso: 'Monaspas beat Eagles. Stack group bonus.',
    vs_gunpowder: 'Rush before Imperial. Monaspas regenerate.',
    vs_monk: 'Regenerating cavalry recovers from failed conversions.',
    vs_spearman: 'Monaspas can fight through pikes with group bonus. Regeneration helps attrition.',
    default: 'Defensive bonuses. Monaspas stronger in groups. Svan Towers. Regenerating cavalry.'
  },
  'Armenians': {
    vs_cavalry: 'Composite Bowmen bonus vs cavalry. Earlier infantry upgrades.',
    vs_archer: 'Composite Bowmen versatile. Mule Cart mobile drop-off.',
    vs_infantry: 'Earlier infantry upgrades. Composite Bowmen kite.',
    vs_siege: 'Composite Bowmen fragile vs siege. Add cavalry.',
    vs_meso: 'Composite Bowmen beat Eagles. Earlier upgrades help.',
    vs_gunpowder: 'Rush with early upgrades. Pressure before Imperial.',
    vs_monk: 'Composite Bowmen kill Monks. Fereters healing helps.',
    vs_spearman: 'Composite Bowmen destroy Spearmen. Bonus damage helps.',
    default: 'Mule Cart mobile drop-off. Earlier infantry upgrades. Composite Bowmen. Fereters healing.'
  },
  // Roman
  'Romans': {
    vs_cavalry: 'Legionaries resist charge damage. Cheap Scorpions support.',
    vs_archer: 'Centurions buff infantry. Push with Legionaries.',
    vs_infantry: 'ADVANTAGE: Legionaries beat infantry. Centurion aura buff.',
    vs_siege: 'Cheap Scorpions duel siege. Legionaries push.',
    vs_meso: 'Legionaries beat Eagles. Centurion aura helps.',
    vs_gunpowder: 'Push with Legionaries before Imperial. Cheap Scorpions.',
    vs_monk: 'Legionaries cheap to lose. Centurions buff.',
    vs_spearman: 'Legionaries beat all infantry. Cheap Scorpions area damage.',
    default: 'Cheap Scorpions from Castle. Centurion aura buffs infantry. Legionaries resist charges.'
  },
  // Chinese Dynasties
  'Jurchens': {
    vs_cavalry: 'Iron Pagodas are very tanky cavalry. Win cavalry fights.',
    vs_archer: 'Iron Pagodas tank arrows. Close distance.',
    vs_infantry: 'Iron Pagodas destroy infantry. Siege support.',
    vs_siege: 'Iron Pagodas tank siege. Cavalry snipes.',
    vs_meso: 'Iron Pagodas beat Eagles. Heavy cavalry power.',
    vs_gunpowder: 'Rush before Imperial. Iron Pagodas tank.',
    vs_monk: 'DANGER: Iron Pagodas expensive to convert. Micro carefully.',
    vs_spearman: 'Iron Pagodas can tank pike damage with high HP. Add ranged support.',
    default: 'Iron Pagoda heavy cavalry. Tanky late game. Siege support.'
  },
  'Khitans': {
    vs_cavalry: 'Cavalry Archers kite cavalry. Raiding bonuses.',
    vs_archer: 'Cavalry Archers beat archers in mobility.',
    vs_infantry: 'Cavalry Archers destroy infantry. Kite easily.',
    vs_siege: 'Cavalry Archers mobile vs siege. Raid around.',
    vs_meso: 'Cavalry Archers + cavalry beat Eagles.',
    vs_gunpowder: 'Rush before Imperial. Cavalry Archer raids.',
    vs_monk: 'Cavalry Archers kill Monks from range.',
    vs_spearman: 'Cavalry Archers kite Spearmen easily. Stay mobile.',
    default: 'Cavalry Archer civilization. Raiding bonuses. Economy bonus early.'
  },
  'Shu': {
    vs_cavalry: 'Defensive bonuses. Zhuge Crossbow rapid fire.',
    vs_archer: 'Zhuge Crossbow high DPS. Defensive play.',
    vs_infantry: 'Zhuge Crossbow destroys infantry.',
    vs_siege: 'Defensive bonuses help. Add cavalry to snipe.',
    vs_meso: 'Zhuge Crossbow beats Eagles. Defensive play.',
    vs_gunpowder: 'Defensive bonuses. Turtle until ready.',
    vs_monk: 'Zhuge Crossbow kills Monks from range.',
    vs_spearman: 'Zhuge Crossbow shreds Spearmen with rapid fire.',
    default: 'Defensive civilization. Zhuge Crossbow rapid fire. Turtle and counter.'
  },
  'Wei': {
    vs_cavalry: 'Tiger Cavalry anti-cavalry bonus. Win cavalry fights.',
    vs_archer: 'Tiger Cavalry closes gap. Aggressive play.',
    vs_infantry: 'Tiger Cavalry destroys infantry. Aggression bonuses.',
    vs_siege: 'Tiger Cavalry snipes siege. Fast and mobile.',
    vs_meso: 'Tiger Cavalry beats Eagles.',
    vs_gunpowder: 'Rush before Imperial. Aggressive timing.',
    vs_monk: 'Tiger Cavalry cheap enough to lose some.',
    vs_spearman: 'Tiger Cavalry can fight pikes with anti-cavalry countered by ranged support.',
    default: 'Aggressive cavalry civilization. Tiger Cavalry. Fast timing attacks.'
  },
  'Wu': {
    vs_cavalry: 'Naval focus but infantry available. Standard anti-cavalry.',
    vs_archer: 'Naval + infantry hybrid. On land use infantry.',
    vs_infantry: 'Infantry bonuses help in infantry fights.',
    vs_siege: 'Infantry snipes siege. Naval dominates water.',
    vs_meso: 'Infantry beats Eagles on land.',
    vs_gunpowder: 'Rush on land. Naval dominates water maps.',
    vs_monk: 'Infantry overwhelms Monks.',
    vs_spearman: 'Archers or Champions beat Spearmen.',
    default: 'Naval + infantry civilization. Dominates hybrid maps. Water control priority.'
  },
};

/**
 * Generates a brief strategy recommendation
 * Uses per-civ strategies when available, falls back to generic advice
 * @param {string} userCiv - User's civilization
 * @param {string} opponentCiv - Opponent civilization
 * @param {Array} opponentStrengths - Opponent's strong units
 * @returns {string} - Strategy recommendation
 */
function generateStrategy(userCiv, opponentCiv, opponentStrengths) {
  const strengthTypes = opponentStrengths.map(s => s.type || getUnitArmorClass(s.unit)).filter(Boolean);
  
  // Check if we have civ-specific strategies
  const civStrategy = CIV_STRATEGIES[userCiv];
  
  if (civStrategy) {
    // Try to match opponent type to strategy
    if (MESO_CIVS.includes(opponentCiv) && civStrategy.vs_meso) {
      return civStrategy.vs_meso;
    }
    if (strengthTypes.includes('Cavalry') && civStrategy.vs_cavalry) {
      return civStrategy.vs_cavalry;
    }
    if (strengthTypes.includes('Archer') || strengthTypes.includes('CavalryArcher')) {
      if (civStrategy.vs_archer) return civStrategy.vs_archer;
    }
    if (strengthTypes.includes('Infantry') || strengthTypes.includes('AntiArcherInfantry')) {
      if (civStrategy.vs_infantry) return civStrategy.vs_infantry;
    }
    if (strengthTypes.includes('SiegeWeapon') && civStrategy.vs_siege) {
      return civStrategy.vs_siege;
    }
    if (strengthTypes.includes('GunpowderUnit') && civStrategy.vs_gunpowder) {
      return civStrategy.vs_gunpowder;
    }
    if (strengthTypes.includes('Monk') && civStrategy.vs_monk) {
      return civStrategy.vs_monk;
    }
    if (strengthTypes.includes('Spearman') && civStrategy.vs_spearman) {
      return civStrategy.vs_spearman;
    }
    
    return civStrategy.default || 'Adapt based on opponent army composition.';
  }
  
  // Generic strategies based on opponent type (fallback)
  if (MESO_CIVS.includes(opponentCiv)) {
    return 'Eagles are their cavalry. Have anti-infantry ready (Champions, Hand Cannoneers). Win before Imperial or prepare infantry counters.';
  }
  if (CAVALRY_CIVS.includes(opponentCiv)) {
    return 'Wall early, have Spearmen ready. Monks are excellent for converting expensive cavalry. Camels if available.';
  }
  if (INFANTRY_CIVS.includes(opponentCiv)) {
    return 'Archers and cavalry destroy infantry. Maintain mobility and range advantage.';
  }
  if (SIEGE_CIVS.includes(opponentCiv)) {
    return 'Have mobile units (cavalry) ready to snipe siege. Dont clump units against Mangonels.';
  }
  if (strengthTypes.includes('GunpowderUnit')) {
    return 'Pressure early before gunpowder mass. Cavalry to close the gap quickly.';
  }
  
  return 'Adapt based on opponent army composition. Scout early to identify their strategy.';
}

// ============================================================================
// Main Generation Function
// ============================================================================

/**
 * Generates matchup file for a single civilization
 * @param {string} civName - The civilization to generate for
 * @param {object} gameData - Full game data
 * @param {object} strings - Strings lookup
 * @param {object} civHelps - Civ help text mapping
 */
function generateCivMatchups(civName, gameData, strings, civHelps) {
  const { techtrees } = gameData;
  const units = gameData.data.units;
  const techs = gameData.data.techs;
  const unitUpgrades = gameData.data.unit_upgrades;
  
  console.log(`Generating matchups for ${civName}...`);
  
  // Build upgraded unit set (units that are NOT first-tier)
  const upgradedSet = buildUpgradedUnitSet(unitUpgrades);
  
  // Get user civ data
  const userBonuses = extractCivBonuses(civName, civHelps, strings);
  const userUniqueUnits = getCivUniqueUnits(civName, techtrees, units, strings);
  const userUniqueTechs = getCivUniqueTechs(civName, techtrees, techs, strings);
  const userAvailableUnits = getCivAvailableUnits(civName, techtrees, upgradedSet, units, strings);
  
  // Generate matchups against all other civs
  const matchups = {};
  const allCivs = Object.keys(techtrees);
  
  for (const opponentCiv of allCivs) {
    if (opponentCiv === civName) continue; // Skip self
    
    matchups[opponentCiv] = generateMatchup(
      civName,
      opponentCiv,
      gameData,
      strings,
      userAvailableUnits,
      civHelps
    );
  }
  
  // Build output structure
  const output = {
    generatedAt: new Date().toISOString(),
    civilization: civName,
    civDescription: getCivDescription(civName),
    bonuses: sortBonusesByStrength(userBonuses),
    uniqueUnit: userUniqueUnits.castle,
    uniqueUnitCategories: getUniqueUnitCategories(userUniqueUnits.castle),
    uniqueUnitElite: userUniqueUnits.imperial,
    uniqueTechs: userUniqueTechs,
    availableUnits: userAvailableUnits.sort(),
    matchups
  };
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Write output file
  const filename = civName.toLowerCase().replace(/\s+/g, '-') + '.json';
  const outputPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`Written: ${outputPath}`);
  console.log(`  - ${Object.keys(matchups).length} opponent matchups generated`);
  
  return output;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.log('AoE2 Civilization Matchup Generator');
  console.log('====================================\n');
  
  try {
    // Download game data
    console.log('Downloading game data...');
    const [gameData, strings] = await Promise.all([
      downloadJson(DATA_URL),
      downloadJson(STRINGS_URL)
    ]);
    console.log('Data downloaded successfully.\n');
    
    // Build civ help text mapping
    const civHelps = buildCivHelpMapping(gameData, strings);
    console.log(`Built help text mapping for ${Object.keys(civHelps).length} civilizations.\n`);
    
    // Load local land units (for future enhanced counter logic)
    let landUnits = null;
    try {
      landUnits = loadLandUnits();
      console.log(`Loaded ${landUnits.totalUnits} land units from local file.\n`);
    } catch (err) {
      console.warn('Warning: Could not load land-units.json:', err.message);
    }
    
    // Get civilization to generate (default: Britons, or from command line)
    const targetCiv = process.argv[2] || 'Britons';
    
    // Handle "all" option to generate for all civilizations
    if (targetCiv.toLowerCase() === 'all') {
      const allCivs = Object.keys(gameData.techtrees).sort();
      console.log(`Generating matchups for all ${allCivs.length} civilizations...\n`);
      
      const startTime = Date.now();
      for (let i = 0; i < allCivs.length; i++) {
        const civ = allCivs[i];
        console.log(`[${i + 1}/${allCivs.length}] ${civ}`);
        generateCivMatchups(civ, gameData, strings, civHelps);
      }
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\nGenerated ${allCivs.length} civilization files in ${elapsed}s`);
    } else {
      // Single civ mode
      if (!gameData.techtrees[targetCiv]) {
        console.error(`Error: Civilization "${targetCiv}" not found.`);
        console.log('Available civilizations:');
        console.log(Object.keys(gameData.techtrees).sort().join(', '));
        console.log('\nUse "all" to generate for all civilizations.');
        process.exit(1);
      }
      
      generateCivMatchups(targetCiv, gameData, strings, civHelps);
    }
    
    console.log('\nDone!');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
