/**
 * AoE2 Land Units Extractor
 * 
 * Downloads Age of Empires 2 tech tree data and extracts land units
 * with their English names, fight statistics, and costs.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_URL = 'https://raw.githubusercontent.com/SiegeEngineers/aoe2techtree/refs/heads/master/data/data.json';
const STRINGS_URL = 'https://raw.githubusercontent.com/SiegeEngineers/aoe2techtree/refs/heads/master/data/locales/en/strings.json';
const OUTPUT_FILE = path.join(__dirname, 'land-units.json');

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
 * Gets the English name for a unit using its LanguageNameId
 * @param {object} unit - The unit object
 * @param {object} strings - The strings lookup object
 * @returns {string} - The English name
 */
function getEnglishName(unit, strings) {
  const nameId = unit.LanguageNameId;
  if (nameId && strings[nameId]) {
    return strings[nameId];
  }
  // Fallback to internal name if no translation found
  return unit.internal_name || `Unknown Unit (${unit.id})`;
}

/**
 * Checks if a unit is a land unit (not a ship/water unit)
 * @param {object} unit - The unit object
 * @returns {boolean} - True if land unit
 */
function isLandUnit(unit) {
  // Ships and water units have specific class IDs
  // Class 22 = Ships, Class 21 = Fishing Ships
  // Also check for "Ship" in internal name as fallback
  const navalClasses = [21, 22];
  
  if (navalClasses.includes(unit.Class)) {
    return false;
  }
  
  // Additional check using internal name
  const internalName = (unit.internal_name || '').toLowerCase();
  if (internalName.includes('ship') || 
      internalName.includes('galley') || 
      internalName.includes('longboat') ||
      internalName.includes('caravel') ||
      internalName.includes('turtle') ||
      internalName.includes('canoe') ||
      internalName.includes('fire_') ||
      internalName.includes('demolition') ||
      internalName.includes('cannon_galleon') ||
      internalName.includes('dromon')) {
    return false;
  }
  
  return true;
}

/**
 * Extracts fight statistics from a unit
 * @param {object} unit - The unit object
 * @returns {object} - Fight statistics
 */
function extractFightStats(unit) {
  const stats = {};
  
  // Basic combat stats
  if (unit.HP !== undefined) stats.HP = unit.HP;
  if (unit.Attack !== undefined) stats.Attack = unit.Attack;
  if (unit.MeleeArmor !== undefined) stats.MeleeArmor = unit.MeleeArmor;
  if (unit.PierceArmor !== undefined) stats.PierceArmor = unit.PierceArmor;
  if (unit.Range !== undefined) stats.Range = unit.Range;
  if (unit.MinRange !== undefined) stats.MinRange = unit.MinRange;
  if (unit.Speed !== undefined) stats.Speed = unit.Speed;
  if (unit.LineOfSight !== undefined) stats.LineOfSight = unit.LineOfSight;
  if (unit.ReloadTime !== undefined) stats.ReloadTime = unit.ReloadTime;
  if (unit.AccuracyPercent !== undefined) stats.AccuracyPercent = unit.AccuracyPercent;
  if (unit.FrameDelay !== undefined) stats.FrameDelay = unit.FrameDelay;
  if (unit.TrainTime !== undefined) stats.TrainTime = unit.TrainTime;
  if (unit.GarrisonCapacity !== undefined) stats.GarrisonCapacity = unit.GarrisonCapacity;
  if (unit.Blast !== undefined) stats.BlastRadius = unit.Blast;
  if (unit.ProjectileCount !== undefined) stats.ProjectileCount = unit.ProjectileCount;
  
  // Attack bonuses - convert class IDs to names where possible
  if (unit.Attacks && Object.keys(unit.Attacks).length > 0) {
    stats.AttackBonuses = {};
    for (const [, attackData] of Object.entries(unit.Attacks)) {
      // attackData has { Amount, Class } structure
      if (attackData && typeof attackData === 'object') {
        const classId = attackData.Class;
        const amount = attackData.Amount;
        const className = getArmorClassName(classId);
        stats.AttackBonuses[className] = amount;
      }
    }
  }
  
  // Armor classes
  if (unit.Armours && Object.keys(unit.Armours).length > 0) {
    stats.Armours = {};
    for (const [, armorData] of Object.entries(unit.Armours)) {
      // armorData has { Amount, Class } structure
      if (armorData && typeof armorData === 'object') {
        const classId = armorData.Class;
        const amount = armorData.Amount;
        const className = getArmorClassName(classId);
        stats.Armours[className] = amount;
      }
    }
  }
  
  return stats;
}

/**
 * Gets human-readable armor class name
 * @param {number} classId - The armor class ID
 * @returns {string} - Human readable name
 */
function getArmorClassName(classId) {
  const armorClasses = {
    1: 'Infantry',
    2: 'TurtleShip',
    3: 'BasePierce',
    4: 'BaseMelee',
    5: 'WarElephant',
    6: 'Unused',
    7: 'Unused',
    8: 'Cavalry',
    9: 'Unused',
    10: 'Unused',
    11: 'AllBuildings',
    12: 'Unused',
    13: 'StoneDefense',
    14: 'FEPredatorAnimal',
    15: 'Archer',
    16: 'ShipsCamelsSaboteur',
    17: 'Ram',
    18: 'Tree',
    19: 'UniqueUnit',
    20: 'SiegeWeapon',
    21: 'StandardBuilding',
    22: 'WallsGates',
    23: 'GunpowderUnit',
    24: 'Boar',
    25: 'Monk',
    26: 'Castle',
    27: 'Spearman',
    28: 'CavalryArcher',
    29: 'EagleWarrior',
    30: 'Camel',
    31: 'AntiLeitisBonus',
    32: 'CondottieroDamage',
    33: 'FishingShip',
    34: 'Mameluke',
    35: 'HeroArmor',
    36: 'Hussite',
    37: 'Charge',
    38: 'Scout',
    39: 'Unused',
  };
  
  return armorClasses[classId] || `Class${classId}`;
}

/**
 * Extracts cost from a unit
 * @param {object} unit - The unit object
 * @returns {object} - Cost breakdown
 */
function extractCost(unit) {
  const cost = {};
  
  if (unit.Cost) {
    if (unit.Cost.Food !== undefined && unit.Cost.Food > 0) cost.Food = unit.Cost.Food;
    if (unit.Cost.Wood !== undefined && unit.Cost.Wood > 0) cost.Wood = unit.Cost.Wood;
    if (unit.Cost.Gold !== undefined && unit.Cost.Gold > 0) cost.Gold = unit.Cost.Gold;
    if (unit.Cost.Stone !== undefined && unit.Cost.Stone > 0) cost.Stone = unit.Cost.Stone;
  }
  
  return Object.keys(cost).length > 0 ? cost : null;
}

/**
 * Main function to extract land units
 */
async function main() {
  console.log('Downloading AoE2 data...');
  
  try {
    // Download both files in parallel
    const [gameData, strings] = await Promise.all([
      downloadJson(DATA_URL),
      downloadJson(STRINGS_URL)
    ]);
    
    console.log('Data downloaded successfully.');
    console.log(`Total units in data: ${Object.keys(gameData.data.units).length}`);
    
    const landUnits = [];
    
    // Process each unit
    for (const [unitId, unit] of Object.entries(gameData.data.units)) {
      // Skip if not a land unit
      if (!isLandUnit(unit)) {
        continue;
      }
      
      const englishName = getEnglishName(unit, strings);
      const fightStats = extractFightStats(unit);
      const cost = extractCost(unit);
      
      const unitData = {
        id: parseInt(unitId),
        name: englishName,
        internalName: unit.internal_name,
        statistics: fightStats
      };
      
      if (cost) {
        unitData.cost = cost;
      }
      
      // Add age availability if present
      if (unit.Age !== undefined) {
        const ages = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'];
        unitData.age = ages[unit.Age] || `Age ${unit.Age}`;
      }
      
      landUnits.push(unitData);
    }
    
    // Sort by name for easier reading
    landUnits.sort((a, b) => a.name.localeCompare(b.name));
    
    console.log(`Extracted ${landUnits.length} land units.`);
    
    // Write to file
    const output = {
      generatedAt: new Date().toISOString(),
      totalUnits: landUnits.length,
      units: landUnits
    };
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`Output written to: ${OUTPUT_FILE}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
