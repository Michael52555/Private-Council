
import type {
  Importance,
  Visibility,
  PlanningMode,
  PreferenceCategory,
  PreferenceInterpretation,
  Preference,
  RestaurantCandidate,
  CandidatePlan,
  RoomConfig,
  LocalAgentState,
} from "@/lib/planning-types";



export type PreferenceScore = {
  category: string;
  score: number; // 0 - 1
  weight: number;
};

export type RestaurantScore = {
  candidateId: string;
  totalScore: number;
  breakdown: PreferenceScore[];
};

export function evaluateDistanceScore(
  candidate: RestaurantCandidate,
  maxDistance:number
){
  if(candidate.distanceMiles<= maxDistance){
    return 1;
  }

  const excess =
    candidate.distanceMiles - maxDistance;

  return Math.exp(-0.5 * excess);
}

export function evaluateBudgetScore(
  candidate: RestaurantCandidate,
  minBudget: number,
  maxBudget: number,
): number {

  const restaurantMin =
    candidate.estimatedPriceMin;

  const restaurantMax =
    candidate.estimatedPriceMax;


  const overlapMin =
    Math.max(minBudget, restaurantMin);

  const overlapMax =
    Math.min(maxBudget, restaurantMax);


  const overlap =
    Math.max(0, overlapMax - overlapMin);


  const restaurantRange =
    restaurantMax - restaurantMin;


  if (restaurantRange <= 0) {
    return overlap > 0 ? 1 : 0;
  }


  return overlap / restaurantRange;
}

export type ScoreBreakdown = {
  category: string;
  score: number;
}[];

export function evaluateRestaurantScore(
  candidate: RestaurantCandidate,
  preferences: Preference[],
) {

  const distancePreference = preferences.find(
  (p) => p.category === "distance"
  );

  const budgetPreference = preferences.find(
  (p) => p.category === "budget"
  );  

  const distanceScore =
  distancePreference?.interpretation?.status === "success"
  && typeof distancePreference.interpretation.structuredData.maxDistanceMiles === "number"

  ? evaluateDistanceScore(
      candidate,
      distancePreference.interpretation.structuredData.maxDistanceMiles
    )

  : 1;


  const budgetScore =
  budgetPreference?.interpretation?.status === "success"
  && typeof budgetPreference.interpretation.structuredData.minPriceDollarsPerPerson === "number"
  && typeof budgetPreference.interpretation.structuredData.maxPriceDollarsPerPerson === "number"

  ? evaluateBudgetScore(
      candidate,
      budgetPreference.interpretation.structuredData.minPriceDollarsPerPerson,
      budgetPreference.interpretation.structuredData.maxPriceDollarsPerPerson,
    )

  : 1;

  const scores = [];

if (distancePreference) {
  scores.push({
    category: "distance",
    score: distanceScore,
    weight: importanceWeight(
      distancePreference.importance
    ),
  });
}


if (budgetPreference) {
  scores.push({
    category: "budget",
    score: budgetScore,
    weight: importanceWeight(
      budgetPreference.importance
    ),
  });
}

if (distancePreference) {
  scores.push({
    category: "distance",
    score: distanceScore,
    weight: importanceWeight(
      distancePreference.importance
    ),
  });
}


if (budgetPreference) {
  scores.push({
    category: "budget",
    score: budgetScore,
    weight: importanceWeight(
      budgetPreference.importance
    ),
  });
}

  const totalScore=combineScores(scores);

  return {
  totalScore,
  breakdown: [
    {
      category: "distance",
      score: distanceScore,
    },
    {
      category: "budget",
      score: budgetScore,
    },
  ],
};
}

export function importanceWeight(
 importance:number
){
 return importance/5;
}

export function combineScores(
 scores: PreferenceScore[]
){
 const totalWeight =
   scores.reduce(
    (sum,s)=>sum+s.weight,
    0
   );

 if(totalWeight===0){
   return 0;
 }

 return scores.reduce(
   (sum,s)=>
    sum+s.score*s.weight,
   0
 ) / totalWeight;
}





