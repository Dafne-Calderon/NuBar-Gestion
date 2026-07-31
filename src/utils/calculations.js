export function money(value) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function number(value, decimals = 1) {
  return new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(Number(value || 0));
}

export function getRecipeItems(recipe) {
  return recipe?.recipe_items || [];
}

const LEGACY_INFLATED_PRICE_THRESHOLD = 1000000;

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Devuelve el precio real por kilo.
 *
 * Algunas instalaciones antiguas guardaron el precio por kilo en `unit_cost`
 * y luego una migración lo multiplicó por 1.000. Esta detección evita que esos
 * datos heredados inflen el costo mientras el usuario los corrige en la base.
 */
export function isLegacyInflatedIngredientPrice(ingredient) {
  const storedPricePerKg = positiveNumber(ingredient?.price_per_kg);
  const legacyValue = positiveNumber(ingredient?.unit_cost);
  const expectedInflated = legacyValue * 1000;
  const difference = Math.abs(storedPricePerKg - expectedInflated);
  const tolerance = Math.max(1, expectedInflated * 0.000001);

  return storedPricePerKg >= LEGACY_INFLATED_PRICE_THRESHOLD
    && legacyValue >= 100
    && legacyValue < LEGACY_INFLATED_PRICE_THRESHOLD
    && difference <= tolerance;
}

export function ingredientPricePerKg(ingredient) {
  const storedPricePerKg = positiveNumber(ingredient?.price_per_kg);
  const legacyValue = positiveNumber(ingredient?.unit_cost);

  if (isLegacyInflatedIngredientPrice(ingredient)) return legacyValue;
  if (storedPricePerKg > 0) return storedPricePerKg;

  // Compatibilidad con datos antiguos: valores altos eran normalmente $/kg;
  // valores bajos eran costo por gramo.
  if (legacyValue >= 100) return legacyValue;
  return legacyValue * 1000;
}

export function ingredientCostPerGram(ingredient) {
  return ingredientPricePerKg(ingredient) / 1000;
}

export function calculateIngredientBreakdown(recipe) {
  return getRecipeItems(recipe).map((item) => {
    const grams = Number(item.grams_per_batch || 0);
    const pricePerKg = ingredientPricePerKg(item.ingredients);
    const cost = (grams / 1000) * pricePerKg;
    return {
      id: item.id,
      ingredientId: item.ingredient_id || item.ingredients?.id,
      name: item.ingredients?.name || 'Ingrediente',
      grams,
      pricePerKg,
      cost,
    };
  });
}

export function calculateBatchIngredientCost(recipe) {
  return calculateIngredientBreakdown(recipe).reduce((total, item) => total + item.cost, 0);
}

export function calculateAdditionalCostsPerBar(recipe) {
  return [
    'packaging_cost',
    'label_cost',
    'labor_cost',
    'energy_cost',
    'transport_cost',
    'advertising_cost',
    'operational_cost',
    'other_cost',
  ].reduce((total, field) => total + Number(recipe?.[field] || 0), 0);
}

export function calculateProfessionalCosts(recipe) {
  const bars = Math.max(Number(recipe?.bars_per_batch || 1), 1);
  const ingredientsBatch = calculateBatchIngredientCost(recipe);
  const ingredientsPerBar = ingredientsBatch / bars;
  const additionalPerBar = calculateAdditionalCostsPerBar(recipe);
  const basePerBar = ingredientsPerBar + additionalPerBar;
  const wastePercent = Number(recipe?.waste_percent || 0);
  const costWithWaste = basePerBar * (1 + wastePercent / 100);
  const salePrice = Number(recipe?.sale_price || 0);
  const commissionPercent = Number(recipe?.commission_percent || 0);
  const commissionCost = salePrice * commissionPercent / 100;
  const totalCostPerBar = costWithWaste + commissionCost;
  const profitPerBar = salePrice - totalCostPerBar;
  const marginPercent = salePrice > 0 ? profitPerBar / salePrice * 100 : 0;
  const desiredMargin = Number(recipe?.desired_margin_percent || 0);
  const denominator = 1 - desiredMargin / 100 - commissionPercent / 100;
  const suggestedPriceNet = denominator > 0 ? costWithWaste / denominator : 0;
  const vatPercent = Number(recipe?.vat_percent ?? 19);
  const suggestedPriceWithVat = suggestedPriceNet * (1 + vatPercent / 100);

  return {
    bars,
    ingredientsBatch,
    ingredientsPerBar,
    additionalPerBar,
    basePerBar,
    wastePercent,
    costWithWaste,
    commissionCost,
    totalCostPerBar,
    profitPerBar,
    marginPercent,
    suggestedPriceNet,
    suggestedPriceWithVat,
  };
}

export function calculateBatchCost(recipe) {
  const costs = calculateProfessionalCosts(recipe);
  return costs.totalCostPerBar * costs.bars;
}

export function calculateCostPerBar(recipe) {
  return calculateProfessionalCosts(recipe).totalCostPerBar;
}

export function calculateMargin(recipe) {
  return calculateProfessionalCosts(recipe).marginPercent;
}

export function scaleRecipe(recipe, desiredBars) {
  const baseBars = Number(recipe?.bars_per_batch || 1);
  const multiplier = Number(desiredBars || 0) / baseBars;
  return getRecipeItems(recipe).map((item) => ({
    ingredient_id: item.ingredient_id,
    name: item.ingredients?.name,
    baseGrams: Number(item.grams_per_batch || 0),
    neededGrams: Number(item.grams_per_batch || 0) * multiplier,
    stock: Number(item.ingredients?.stock_qty || 0),
    missing: Math.max(0, Number(item.grams_per_batch || 0) * multiplier - Number(item.ingredients?.stock_qty || 0)),
  }));
}

function addNutrition(acc, item) {
  const ingredient = item.ingredients;
  const grams = Number(item.grams_per_batch || 0);
  const factor = grams / 100;
  acc.kcal += Number(ingredient?.kcal_100g || 0) * factor;
  acc.protein += Number(ingredient?.protein_100g || 0) * factor;
  acc.carbs += Number(ingredient?.carbs_100g || 0) * factor;
  acc.sugars += Number(ingredient?.sugars_100g || 0) * factor;
  acc.fat += Number(ingredient?.fat_100g || 0) * factor;
  acc.satFat += Number(ingredient?.sat_fat_100g || 0) * factor;
  acc.transFat += Number(ingredient?.trans_fat_100g || 0) * factor;
  acc.fiber += Number(ingredient?.fiber_100g || 0) * factor;
  acc.sodiumMg += Number(ingredient?.sodium_mg_100g || 0) * factor;
  acc.totalGrams += grams;
  return acc;
}

export function calculateNutrition(recipe) {
  const totals = getRecipeItems(recipe).reduce(addNutrition, { kcal: 0, protein: 0, carbs: 0, sugars: 0, fat: 0, satFat: 0, transFat: 0, fiber: 0, sodiumMg: 0, totalGrams: 0 });
  const bars = Number(recipe?.bars_per_batch || 1);
  const barWeight = Number(recipe?.bar_weight_g || (totals.totalGrams / bars) || 1);
  const perBarFactor = 1 / bars;
  const per100Factor = totals.totalGrams ? 100 / totals.totalGrams : 0;
  const perBar = { kcal: totals.kcal * perBarFactor, protein: totals.protein * perBarFactor, carbs: totals.carbs * perBarFactor, sugars: totals.sugars * perBarFactor, fat: totals.fat * perBarFactor, satFat: totals.satFat * perBarFactor, transFat: totals.transFat * perBarFactor, fiber: totals.fiber * perBarFactor, sodiumMg: totals.sodiumMg * perBarFactor, weight: barWeight };
  const per100g = { kcal: totals.kcal * per100Factor, protein: totals.protein * per100Factor, carbs: totals.carbs * per100Factor, sugars: totals.sugars * per100Factor, fat: totals.fat * per100Factor, satFat: totals.satFat * per100Factor, transFat: totals.transFat * per100Factor, fiber: totals.fiber * per100Factor, sodiumMg: totals.sodiumMg * per100Factor };
  return { totals, perBar, per100g };
}

export function evaluateChileWarningSeals(per100g) {
  const seals = [];
  if (Number(per100g.kcal || 0) >= 275) seals.push('ALTO EN CALORÍAS');
  if (Number(per100g.sugars || 0) >= 10) seals.push('ALTO EN AZÚCARES');
  if (Number(per100g.satFat || 0) >= 4) seals.push('ALTO EN GRASAS SATURADAS');
  if (Number(per100g.sodiumMg || 0) >= 400) seals.push('ALTO EN SODIO');
  return seals;
}
