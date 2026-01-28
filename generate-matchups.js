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
 * Gets timing windows for a matchup based on opponent's strengths
 * @param {string} userCiv - User's civilization
 * @param {string} opponentCiv - Opponent's civilization
 * @param {Array} opponentStrengths - Opponent's identified strengths
 * @param {string[]} opponentBonuses - Opponent's civ bonuses
 * @returns {{yourStrength: string, opponentStrength: string, keyTiming: string}}
 */
function getTimingWindows(userCiv, opponentCiv, opponentStrengths, opponentBonuses) {
  const strengthTypes = opponentStrengths.map(s => s.type || getUnitArmorClass(s.unit)).filter(Boolean);
  const bonusText = opponentBonuses.join(' ').toLowerCase();
  
  let yourStrength = '';
  let opponentStrength = '';
  let keyTiming = '';
  
  // Meso civs - Eagles are strong in Imperial
  if (MESO_CIVS.includes(opponentCiv)) {
    opponentStrength = 'Imperial Age when Eagles are fully upgraded (+4 armor, +60 HP)';
    keyTiming = 'End game before Imperial or have infantry ready';
  }
  // Cavalry civs - Knights peak in Castle Age
  else if (CAVALRY_CIVS.includes(opponentCiv)) {
    opponentStrength = 'Castle Age Knight rush and Imperial Paladin timing';
    keyTiming = 'Have Spearmen ready by minute 18-20';
  }
  // Infantry civs - Usually Castle/Imperial
  else if (INFANTRY_CIVS.includes(opponentCiv)) {
    opponentStrength = 'Imperial Age with Champion spam or unique infantry';
    keyTiming = 'Maintain archer mass and mobility';
  }
  // Siege civs
  else if (SIEGE_CIVS.includes(opponentCiv)) {
    opponentStrength = 'Castle Age Mangonel timing and Imperial Siege Onagers';
    keyTiming = 'Split archers vs siege, have cavalry ready to snipe';
  }
  // Gunpowder civs
  else if (GUNPOWDER_CIVS.includes(opponentCiv)) {
    opponentStrength = 'Imperial Age with Hand Cannoneers/Bombard Cannons';
    keyTiming = 'Pressure early, dont let them boom to Imperial';
  }
  else {
    opponentStrength = 'Imperial Age with full upgrades';
    keyTiming = 'Apply pressure in Castle Age';
  }
  
  // User civ specific timings
  if (userCiv === 'Britons') {
    yourStrength = 'Castle Age with Crossbow mass (+1 range). Longbowmen in late Castle.';
  } else if (CAVALRY_CIVS.includes(userCiv)) {
    yourStrength = 'Castle Age Knight timing (minute 18-22)';
  } else if (ARCHER_CIVS.includes(userCiv)) {
    yourStrength = 'Castle Age Crossbow mass';
  } else if (INFANTRY_CIVS.includes(userCiv)) {
    yourStrength = 'Feudal Men-at-Arms pressure, Imperial Champion flood';
  } else {
    yourStrength = 'Castle Age power spike with unique units';
  }
  
  return { yourStrength, opponentStrength, keyTiming };
}

/**
 * Extracts key military bonuses from the full bonus list
 * These are bonuses that directly affect army composition/strength
 * @param {string[]} bonuses - Full list of bonuses
 * @returns {string[]} - Key military bonuses
 */
function extractKeyMilitaryBonuses(bonuses) {
  const keyBonuses = [];
  
  const militaryKeywords = [
    'attack', 'damage', 'hp', 'health', 'armor', 'speed', 'faster',
    'cost', 'cheaper', 'free', 'bonus', 'range', 'train', 
    'cavalry', 'archer', 'infantry', 'siege', 'monk', 'knight',
    'spearman', 'militia', 'scout', 'eagle', 'camel',
    'castle', 'unique', 'military', 'barracks', 'stable', 'archery'
  ];
  
  for (const bonus of bonuses) {
    const lowerBonus = bonus.toLowerCase();
    // Check if this bonus contains military keywords
    if (militaryKeywords.some(keyword => lowerBonus.includes(keyword))) {
      keyBonuses.push(bonus);
    }
  }
  
  return keyBonuses;
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
    if (bonusText.includes('cavalry') || bonusText.includes('knight') || bonusText.includes('stable')) {
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
  
  // Get counters for each opponent strength
  // Prioritize: first counter for each strength, then additional counters
  const primaryCounters = []; // One counter per strength
  const additionalCounters = []; // Extra counters
  const seenStrengths = new Set();
  const seen = new Set();
  
  for (const strength of opponentStrengths) {
    const unitCounters = getCountersFor(strength.unit, userAvailableUnits);
    let addedPrimary = false;
    
    for (const counter of unitCounters) {
      // counter has {unit, reason} from COUNTER_MATRIX
      const key = `${counter.unit}-${strength.unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      
      const counterObj = {
        use: counter.unit,
        against: strength.unit,
        reason: counter.reason
      };
      
      if (!addedPrimary && !seenStrengths.has(strength.unit)) {
        // First counter for this strength
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
  const MAX_ADDITIONAL = 3;
  const allCounters = [...primaryCounters, ...additionalCounters.slice(0, MAX_ADDITIONAL)];
  
  // Get timing windows with opponent strength context
  const timingWindows = getTimingWindows(userCiv, opponentCiv, opponentStrengths, opponentBonuses);
  
  return {
    difficulty: getMatchupDifficulty(userCiv, opponentCiv, opponentStrengths),
    keyBonuses: keyMilitaryBonuses.slice(0, 3), // Top 3 KEY military bonuses (emphasized)
    allBonuses: opponentBonuses, // Full bonus list
    opponentUniqueUnit: opponentUniqueUnits.castle,
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
 * Generates a brief strategy recommendation
 * @param {string} userCiv - User's civilization
 * @param {string} opponentCiv - Opponent civilization
 * @param {Array} opponentStrengths - Opponent's strong units
 * @returns {string} - Strategy recommendation
 */
function generateStrategy(userCiv, opponentCiv, opponentStrengths) {
  const strengthTypes = opponentStrengths.map(s => s.type || getUnitArmorClass(s.unit)).filter(Boolean);
  
  // Britons-specific strategies
  if (userCiv === 'Britons') {
    // Meso civs with Eagles
    if (MESO_CIVS.includes(opponentCiv)) {
      return 'CRITICAL: Eagles counter archers in Imperial. Win early with Crossbow mass or add Champion/Knights. Avoid late game archer-only composition.';
    }
    
    if (strengthTypes.includes('Cavalry')) {
      return 'Mass Crossbows with Spearman support. Use +1/+2 range to kite Knights. Keep Monks behind to convert expensive cavalry.';
    }
    if (strengthTypes.includes('Infantry')) {
      return 'Archers destroy infantry. Keep distance and micro. Watch for siege support - have cavalry ready to snipe Mangonels.';
    }
    if (strengthTypes.includes('SiegeWeapon')) {
      return 'DANGER: Siege counters archers. Keep Knights/Light Cav to snipe siege. Split archers to minimize Mangonel damage.';
    }
    if (strengthTypes.includes('Archer')) {
      return 'Archer mirror - your +1/+2 range wins fights. Add Skirmishers to trade efficiently. Get Longbowmen for max range.';
    }
    if (strengthTypes.includes('Monk')) {
      return 'Monks threaten your Knights. Use archers to kill Monks from range. Light Cavalry is cheap and hard to convert.';
    }
    if (strengthTypes.includes('GunpowderUnit')) {
      return 'Pressure early before Hand Cannoneers arrive. Your archers outrange them. Avoid prolonged Imperial Age fights.';
    }
    
    return 'Standard Crossbow play in Castle Age. Get +1/+2 range bonus. Transition to Longbowmen. Control with range advantage.';
  }
  
  // Generic strategies based on opponent type
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
    bonuses: userBonuses,
    uniqueUnit: userUniqueUnits.castle,
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
