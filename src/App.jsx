import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Home, MessageSquarePlus, ClipboardList, Scale, Sparkles, Settings2,
  ChevronLeft, ChevronRight, Plus, Loader2, Utensils, Dumbbell, Footprints,
  Trash2, Pencil, Check, X, AlertCircle, MessageCircle, Upload, Send,
  TrendingUp, TrendingDown, Moon, Camera, MoreHorizontal
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar
} from "recharts";
import { storage } from "./storage.js";

/* ---------------------------------------------------------------------- */
/*  Constants & helpers                                                   */
/* ---------------------------------------------------------------------- */

const MACROS = [
  { key: "calories", label: "Calories", unit: "kcal", color: "#E8A33D" },
  { key: "carbs",    label: "Carbs",    unit: "g",    color: "#C1442E" },
  { key: "fiber",    label: "Fiber",    unit: "g",    color: "#6B8A5A" },
  { key: "protein",  label: "Protein",  unit: "g",    color: "#A24B5E" },
  { key: "fat",      label: "Fat",      unit: "g",    color: "#8B5E3C" },
];

// Approximate adult RDAs — used only to gauge likely weekly coverage, not medical targets.
const MICROS = [
  { key: "calcium",   label: "Calcium",     unit: "mg",  rda: 1000 },
  { key: "iron",      label: "Iron",        unit: "mg",  rda: 18 },
  { key: "potassium", label: "Potassium",   unit: "mg",  rda: 3500 },
  { key: "magnesium", label: "Magnesium",   unit: "mg",  rda: 400 },
  { key: "b12",       label: "Vitamin B12", unit: "mcg", rda: 2.4 },
  { key: "vitaminD",  label: "Vitamin D",   unit: "mcg", rda: 15 },
  { key: "folate",    label: "Folate",      unit: "mcg", rda: 400 },
  { key: "zinc",      label: "Zinc",        unit: "mg",  rda: 11 },
  { key: "omega3",    label: "Omega-3",     unit: "g",   rda: 1.6 },
  { key: "vitaminC",  label: "Vitamin C",   unit: "mg",  rda: 90 },
  { key: "vitaminA",  label: "Vitamin A",   unit: "mcg", rda: 900 },
  { key: "iodine",    label: "Iodine",      unit: "mcg", rda: 150 },
];

const ACTIVITY_MULT = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };

const DEFAULT_PROFILE = {
  name: "", age: 30, sex: "male", height: 170, weight: 70,
  activity: "moderate",
  calorieTarget: 2000, carbTarget: 220, fiberTarget: 35, proteinTarget: 100, fatTarget: 60,
  goalType: "lose",        // "lose" | "maintain" | "gain"
  weeklyRateGoal: 0.5,     // target kg/week change (magnitude)
  autoTargets: true,       // calculate calorie/macro targets from profile (BMR/TDEE/goal) instead of manual entry
  adaptiveBudget: true,    // on top of that, nudge targets weekly based on actual vs. goal progress
  calorieFloor: 1200,
  calorieCeiling: 3000,
  lastAdjustmentWeek: null,
  targetsInitialized: false,
};

function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return dateKey(new Date()); }
function addDays(key, n) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
function labelForKey(key) {
  const d = new Date(key + "T00:00:00");
  const today = todayKey();
  if (key === today) return "Today";
  if (key === addDays(today, -1)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function startOfWeek(key) {
  const d = new Date(key + "T00:00:00");
  const day = d.getDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  return dateKey(d);
}
function weekDates(anchorKey, offsetWeeks) {
  const start = addDays(startOfWeek(anchorKey), offsetWeeks * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function round(n, d = 0) {
  const f = Math.pow(10, d);
  return Math.round((Number(n) || 0) * f) / f;
}
function sumMeals(meals) {
  const t = { calories: 0, carbs: 0, fiber: 0, protein: 0, fat: 0 };
  (meals || []).forEach((m) => {
    MACROS.forEach(({ key }) => { t[key] += Number(m.totals?.[key]) || 0; });
  });
  return t;
}
function sumMicros(meals) {
  const t = {};
  MICROS.forEach(({ key }) => { t[key] = 0; });
  (meals || []).forEach((m) => {
    MICROS.forEach(({ key }) => { t[key] += Number(m.micros?.[key]) || 0; });
  });
  return t;
}

/* ---- date ranges for Week / Month / Year / Custom reports ---- */

function periodDates(period, offset, customStart, customEnd) {
  const today = todayKey();
  if (period === "week") return weekDates(today, offset);
  if (period === "month") {
    const d = new Date(today + "T00:00:00");
    d.setMonth(d.getMonth() + offset, 1);
    const year = d.getFullYear(), month = d.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => dateKey(new Date(year, month, i + 1)));
  }
  if (period === "year") {
    const d = new Date(today + "T00:00:00");
    const year = d.getFullYear() + offset;
    const out = [];
    let cur = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    while (cur <= end) { out.push(dateKey(cur)); cur.setDate(cur.getDate() + 1); }
    return out;
  }
  if (period === "custom") {
    if (!customStart || !customEnd || customStart > customEnd) return [];
    const out = [];
    let cur = new Date(customStart + "T00:00:00");
    const end = new Date(customEnd + "T00:00:00");
    let guard = 0;
    while (cur <= end && guard < 730) { out.push(dateKey(cur)); cur.setDate(cur.getDate() + 1); guard++; }
    return out;
  }
  return [];
}

function periodLabel(period, offset, dates, customStart, customEnd) {
  if (!dates.length) return "No range selected";
  if (period === "week") return `Week of ${dates[0].slice(5)} – ${dates[6].slice(5)}`;
  if (period === "month") {
    const d = new Date(dates[0] + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (period === "year") return dates[0].slice(0, 4);
  return `${customStart} – ${customEnd}`;
}

function bucketRange(dates, meals, maxBuckets = 12) {
  const n = dates.length;
  if (!n) return [];
  const bucketSize = Math.max(1, Math.ceil(n / maxBuckets));
  const buckets = [];
  for (let i = 0; i < n; i += bucketSize) {
    const chunk = dates.slice(i, i + bucketSize);
    const logged = chunk.map((d) => ({ t: sumMeals(meals[d] || []), has: (meals[d] || []).length > 0 })).filter((x) => x.has);
    const avgCal = logged.length ? round(logged.reduce((s, x) => s + x.t.calories, 0) / logged.length) : 0;
    buckets.push({
      label: chunk.length > 1 ? `${chunk[0].slice(5)}` : chunk[0].slice(5),
      calories: avgCal,
    });
  }
  return buckets;
}

/* ---- adaptive weekly calorie budget ---- */

const KCAL_PER_KG = 7700;

function weekWeightAverage(weights, dates) {
  const ws = weights.filter((w) => dates.includes(w.date));
  if (ws.length < 3) return null; // require at least 3 logs in the week for a meaningful average
  return ws.reduce((s, w) => s + w.weight, 0) / ws.length;
}

// Base targets derived purely from profile: BMR (Mifflin-St Jeor) -> TDEE -> a
// calorie target that bakes in the goal rate, then protein by bodyweight and
// fat/carb/fiber filled in around it.
function computeAutoTargets(profile, weightForBmr) {
  const w = weightForBmr || profile.weight;
  const bmr = profile.sex === "male"
    ? 10 * w + 6.25 * profile.height - 5 * profile.age + 5
    : 10 * w + 6.25 * profile.height - 5 * profile.age - 161;
  const tdee = bmr * (ACTIVITY_MULT[profile.activity] || 1.375);
  const direction = profile.goalType === "lose" ? -1 : profile.goalType === "gain" ? 1 : 0;
  const dailyDelta = (direction * Math.abs(profile.weeklyRateGoal || 0) * KCAL_PER_KG) / 7;

  let calorieTarget = round(tdee + dailyDelta);
  calorieTarget = Math.max(profile.calorieFloor || 1200, Math.min(profile.calorieCeiling || 3000, calorieTarget));

  const proteinPerKg = profile.goalType === "maintain" ? 1.6 : 1.8; // higher while actively losing/gaining, to protect muscle
  const proteinTarget = round(proteinPerKg * w);
  const fatTarget = round((calorieTarget * 0.25) / 9);
  const proteinCals = proteinTarget * 4;
  const fatCals = fatTarget * 9;
  const carbCals = Math.max(0, calorieTarget - proteinCals - fatCals);
  const carbTarget = round(carbCals / 4);
  const fiberTarget = round(14 * (calorieTarget / 1000)); // ~14g fiber per 1000kcal

  return { calorieTarget, proteinTarget, fatTarget, carbTarget, fiberTarget, bmr: round(bmr), tdee: round(tdee) };
}

// Compares the last two fully-completed weeks of weigh-ins against the user's
// goal rate, and proposes a new daily calorie target. Runs once per week.
function computeBudgetAdjustment(profile, weights) {
  if (!profile.adaptiveBudget) return null;
  const today = todayKey();
  const lastWeek = weekDates(today, -1);
  const priorWeek = weekDates(today, -2);
  const lastAvg = weekWeightAverage(weights, lastWeek);
  const priorAvg = weekWeightAverage(weights, priorWeek);
  if (lastAvg == null || priorAvg == null) return null;

  const actualChange = lastAvg - priorAvg; // negative = weight went down
  const direction = profile.goalType === "lose" ? -1 : profile.goalType === "gain" ? 1 : 0;
  const expectedChange = direction * Math.abs(profile.weeklyRateGoal || 0);
  const gap = actualChange - expectedChange; // >0 = behind pace (need bigger deficit / smaller surplus)

  let dailyAdjustment = (gap * KCAL_PER_KG) / 7;
  dailyAdjustment = Math.max(-150, Math.min(150, dailyAdjustment)); // cap swing per week
  if (Math.abs(dailyAdjustment) < 15) return null; // negligible

  let newTarget = round(profile.calorieTarget - dailyAdjustment);
  newTarget = Math.max(profile.calorieFloor || 1200, Math.min(profile.calorieCeiling || 3000, newTarget));
  if (newTarget === profile.calorieTarget) return null;

  return {
    id: uid(),
    weekStart: lastWeek[0],
    oldTarget: profile.calorieTarget,
    newTarget,
    actualChange: round(actualChange, 2),
    expectedChange: round(expectedChange, 2),
    appliedOn: today,
  };
}

// Auto-targets mode: recompute the BMR-based baseline off last week's average
// weight (so the budget naturally drops as you get lighter), then layer the
// same progress-vs-goal nudge on top, keeping protein fixed and rebalancing
// fat/carb/fiber around the adjusted calorie total.
function computeWeeklyTargetUpdate(profile, weights) {
  const today = todayKey();
  const lastWeek = weekDates(today, -1);
  const priorWeek = weekDates(today, -2);
  const lastAvg = weekWeightAverage(weights, lastWeek);
  const priorAvg = weekWeightAverage(weights, priorWeek);

  const base = computeAutoTargets(profile, lastAvg != null ? lastAvg : profile.weight);

  if (!profile.adaptiveBudget || lastAvg == null || priorAvg == null) {
    return { targets: base, adjustment: null };
  }

  const actualChange = lastAvg - priorAvg;
  const direction = profile.goalType === "lose" ? -1 : profile.goalType === "gain" ? 1 : 0;
  const expectedChange = direction * Math.abs(profile.weeklyRateGoal || 0);
  const gap = actualChange - expectedChange;
  let dailyAdjustment = (gap * KCAL_PER_KG) / 7;
  dailyAdjustment = Math.max(-150, Math.min(150, dailyAdjustment));

  if (Math.abs(dailyAdjustment) < 15) return { targets: base, adjustment: null };

  let newCalorieTarget = round(base.calorieTarget - dailyAdjustment);
  newCalorieTarget = Math.max(profile.calorieFloor || 1200, Math.min(profile.calorieCeiling || 3000, newCalorieTarget));

  const proteinCals = base.proteinTarget * 4;
  const fatTarget = round((newCalorieTarget * 0.25) / 9);
  const carbCals = Math.max(0, newCalorieTarget - proteinCals - fatTarget * 9);
  const targets = {
    calorieTarget: newCalorieTarget,
    proteinTarget: base.proteinTarget,
    fatTarget,
    carbTarget: round(carbCals / 4),
    fiberTarget: round(14 * (newCalorieTarget / 1000)),
  };

  if (newCalorieTarget === profile.calorieTarget) return { targets, adjustment: null };

  return {
    targets,
    adjustment: {
      id: uid(), weekStart: lastWeek[0],
      oldTarget: profile.calorieTarget, newTarget: newCalorieTarget,
      actualChange: round(actualChange, 2), expectedChange: round(expectedChange, 2),
      appliedOn: today,
    },
  };
}

/* ---------------------------------------------------------------------- */
/*  Claude API helpers                                                    */
/* ---------------------------------------------------------------------- */

const CUISINE_CONTEXT = `You have deep knowledge of Indian and South Indian (especially Karnataka/Kannada) home cooking terms, including but not limited to: idli, dosa, set dosa, ragi dosa, ragi rotti, jola rotti, chapati/roti, puliyogare, bisibele bath, godhi nucchu, sagu, palya, tovve/pappu, majjige huli, payasa, obbattu/holige, mysore pak, boondi, khara boondi, murukku, chakli, churmuri, samosa, vada, bajji, paneer, soya chunks, chana/kadle, hesaru kalu, halsande kalu, kabuli chana. Understand Kannada/regional names and common variants. Distinguish raw/dry vs cooked quantities (e.g. "50g soya chunks" means dry weight unless stated otherwise).`;

async function callClaude(system, userText, { json = false } = {}) {
  const res = await fetch("/.netlify/functions/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: userText }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("\n");
  if (json) {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  }
  return text;
}

async function parseMealWithAI(rawText, customFoods) {
  const customBlock = (customFoods || []).length
    ? `\n\nThe user has these personal saved food definitions — use them when the name matches instead of guessing:\n${customFoods.map((f) => `- ${f.name}: ${f.description}`).join("\n")}`
    : "";
  const microKeys = MICROS.map((m) => `"${m.key}"`).join(", ");
  const system = `You are a careful nutrition-estimation engine for a personal Indian/vegetarian food tracker. ${CUISINE_CONTEXT}${customBlock}

Given a natural-language meal description, break it into individual food items and estimate nutrition for each, then sum totals, including a best-effort estimate of micronutrients for the whole meal (use 0 for negligible amounts, never omit a key). Always treat these as reasonable estimates, since home cooking varies.

Respond with ONLY valid JSON, no preamble, no markdown fences, matching exactly this shape:
{
  "mealType": "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Drink" | "Dessert",
  "items": [
    { "name": string, "quantity": string, "calories": number, "carbs": number, "fiber": number, "protein": number, "fat": number }
  ],
  "totals": { "calories": number, "carbs": number, "fiber": number, "protein": number, "fat": number },
  "micros": { ${microKeys}: number (units: mg for calcium/iron/potassium/magnesium/zinc/vitaminC, mcg for b12/vitaminD/folate/vitaminA/iodine, g for omega3) },
  "note": string (one short sentence flagging this is an estimate, and calling out anything uncertain)
}`;
  return callClaude(system, rawText, { json: true });
}

async function parseExerciseWithAI(rawText) {
  const system = `You are an exercise-log parser for a personal fitness tracker. Given a natural-language workout or activity description (which may list exercises with sets/reps, a duration, a walk, or a device-reported calorie burn), extract structured data and estimate calories burned if not explicitly given.

Respond with ONLY valid JSON, no preamble, no markdown fences, matching exactly this shape:
{
  "summary": string (short human-readable summary),
  "durationMinutes": number | null,
  "steps": number | null,
  "estimatedCalories": number,
  "source": "device-reported" | "app-estimated",
  "entries": [ { "exercise": string, "sets": number|null, "reps": number|null } ]
}`;
  return callClaude(system, rawText, { json: true });
}

async function parseSleepWithAI(rawText) {
  const system = `You are a sleep-log parser for a personal health tracker. Given a natural-language description of last night's sleep (bedtime, wake time, wake-ups, how it felt), extract structured data.

Respond with ONLY valid JSON, no preamble, no markdown fences, matching exactly this shape:
{
  "hours": number,
  "quality": "poor" | "fair" | "good" | "excellent",
  "bedtime": string | null,
  "wakeTime": string | null,
  "note": string (one short sentence, e.g. flagging interruptions)
}`;
  return callClaude(system, rawText, { json: true });
}

async function generateWeeklyInsight(payload) {
  const system = `You are a knowledgeable, warm fitness and nutrition coach who has been personally tracking this user's Indian/vegetarian diet for a while. You know their real-life context (travel days, festivals, missed workouts happen) and never shame them. Focus on consistency over the period shown, not perfection. Point out genuine patterns only if the data supports them — don't invent detail beyond what's given. Keep it concise: 4-7 short sentences, plain prose, no headers or bullet lists, practical and specific.`;
  const userText = `Here is this period's aggregated tracking data as JSON. Write coach notes for the user based on it:\n\n${JSON.stringify(payload, null, 2)}`;
  return callClaude(system, userText, { json: false });
}

async function callClaudeMessages(system, messages) {
  const res = await fetch("/.netlify/functions/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemini", max_tokens: 1000, system, messages }),
  });
  const data = await res.json();
  return (data.content || []).map((b) => b.text || "").join("\n");
}

const NUTRITION_PERSONA = `You are the in-app nutrition coach for "Forge", a personal Indian/vegetarian nutrition and fat-loss tracker. ${CUISINE_CONTEXT} Answer the user's questions about nutrition, their own logged data, or the app itself, in a warm, knowledgeable, non-judgmental tone — like a fitness buddy, not a robotic calculator. Use the context below when it's relevant, but don't recite it back unless asked. Keep answers concise and practical (a few sentences, plain prose). For anything that sounds like a specific medical concern, recommend seeing a doctor rather than diagnosing.`;

const EXERCISE_PERSONA = `You are the in-app exercise coach for "Forge", a personal fat-loss tracker. You help the user think through their training circuit, exercise selection, sets/reps/progression, balancing muscle groups across the week, working around missed sessions or soreness, and how sleep and recovery affect their training. You are warm, practical, and never shame a missed workout. Use the context below (recent logged workouts, sleep, weight trend, goal) when relevant, but don't recite it back unless asked. Keep answers concise. For pain, injury, or anything that sounds medical, recommend seeing a doctor or physiotherapist rather than diagnosing or prescribing rehab.`;

async function chatWithAI(persona, history, contextSummary, newMessage) {
  const system = `${persona}\n\nContext about this user:\n${contextSummary}`;
  const messages = [...history.map((h) => ({ role: h.role, content: h.content })), { role: "user", content: newMessage }];
  return callClaudeMessages(system, messages);
}

/* ---- screenshot analysis (Dr.Trust 360 or any scale-app screenshot) ---- */

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Read failed"));
    r.readAsDataURL(file);
  });
}

async function parseWeightScreenshot(file) {
  const base64 = await readFileAsBase64(file);
  const mediaType = file.type || "image/jpeg";
  const res = await fetch("/.netlify/functions/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini",
      max_tokens: 1000,
      system: `You extract body-composition readings from a screenshot of a smart-scale app (such as Dr.Trust 360). Respond with ONLY valid JSON, no preamble, no markdown fences, matching exactly this shape:
{ "weight": number | null, "weightUnit": "kg" | "lb" | null, "bodyFatPct": number | null, "muscleMassKg": number | null, "bmi": number | null, "confidence": "high" | "medium" | "low", "note": string }`,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Extract the readings visible in this screenshot." },
        ],
      }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("\n");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

/* ---------------------------------------------------------------------- */
/*  Storage                                                                */
/* ---------------------------------------------------------------------- */

async function loadAll() {
  const keys = ["dabba:profile", "dabba:meals", "dabba:weights", "dabba:exercise", "dabba:customFoods", "dabba:budgetLog", "dabba:chatHistory", "dabba:exerciseChatHistory", "dabba:sleep"];
  const out = {};
  for (const k of keys) {
    try {
      const r = await storage.get(k);
      out[k] = r ? JSON.parse(r.value) : null;
    } catch (e) {
      out[k] = null;
    }
  }
  return out;
}
async function save(key, value) {
  try {
    await storage.set(key, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}

/* ---------------------------------------------------------------------- */
/*  Dabba gauge — the signature visual                                    */
/* ---------------------------------------------------------------------- */

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function wedge(cx, cy, r, a0, a1) {
  if (r <= 0.5) return "";
  const p0 = polar(cx, cy, r, a1);
  const p1 = polar(cx, cy, r, a0);
  const large = a1 - a0 <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 0 ${p1.x} ${p1.y} Z`;
}

function DabbaGauge({ values, targets, size = 220 }) {
  const cx = size / 2, cy = size / 2;
  const R = size * 0.44, r0 = size * 0.13, gap = 5;
  const segAngle = 360 / MACROS.length;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={R + 6} fill="#231F1B" stroke="#4A443C" strokeWidth="2" />
      {MACROS.map((m, i) => {
        const a0 = i * segAngle + gap / 2;
        const a1 = (i + 1) * segAngle - gap / 2;
        const val = Number(values?.[m.key]) || 0;
        const target = Number(targets?.[m.key]) || 1;
        const pct = Math.max(0, Math.min(1, val / target));
        const over = val / target > 1.05;
        const rFill = r0 + (R - r0) * pct;
        return (
          <g key={m.key}>
            <path d={wedge(cx, cy, R, a0, a1)} fill="#332D26" />
            <path d={wedge(cx, cy, rFill, a0, a1)} fill={m.color} opacity={over ? 0.55 : 0.92} />
            {over && (
              <path d={wedge(cx, cy, R, a0, a1)} fill="none" stroke="#C1442E" strokeWidth="2" />
            )}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={r0 - 2} fill="#1C1A17" stroke="#4A443C" strokeWidth="1.5" /> <text x={cx} y={cy - 3} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize={size * 0.1} fill="#F2EEE6" fontWeight="600">
        {round(values?.calories || 0)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontFamily="'Work Sans', sans-serif" fontSize={size * 0.045} fill="#B8B0A2">
        kcal
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------------- */
/*  Small UI atoms                                                        */
/* ---------------------------------------------------------------------- */

function Card({ children, style }) {
  return <div className="dabba-card" style={style}>{children}</div>;
}
function SectionTitle({ eyebrow, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <div className="section-title">{children}</div>
    </div>
  );
}
function MacroList({ values, targets }) {
  return (
    <div>
      {MACROS.map((m) => {
        const val = round(values?.[m.key] || 0, m.key === "calories" ? 0 : 1);
        const tgt = targets?.[m.key];
        return (
          <div className="macro-row" key={m.key}>
            <span className="macro-dot" style={{ background: m.color }} />
            <span className="macro-label">{m.label}</span>
            <span className="macro-val">
              {val}{m.unit}{tgt ? <span className="macro-target"> / {round(tgt)}{m.unit}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MicroList({ values }) {
  return (
    <div>
      {MICROS.map((m) => {
        const val = round(values?.[m.key] || 0, 1);
        const pct = m.rda ? Math.round((val / m.rda) * 100) : 0;
        const barColor = pct < 60 ? "#C1442E" : pct < 90 ? "#E8A33D" : "#6B8A5A";
        return (
          <div className="micro-row" key={m.key}>
            <div className="micro-label-row">
              <span>{m.label}</span>
              <span className="stat-sub">{val}{m.unit} · {pct}%</span>
            </div>
            <div className="micro-bar-track">
              <div className="micro-bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: barColor }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Dashboard                                                             */
/* ---------------------------------------------------------------------- */

function Dashboard({ profile, meals, weights, exercise, sleep, budgetLog }) {
  const today = todayKey();
  const latestAdjustment = budgetLog.length ? budgetLog[budgetLog.length - 1] : null;
  const showAdjustmentBanner = latestAdjustment && latestAdjustment.weekStart === weekDates(today, -1)[0];
  const todaySleep = sleep[today];
  const todayMeals = meals[today] || [];
  const todayEx = exercise[today] || [];
  const totals = sumMeals(todayMeals);
  const lastWeight = weights.length ? weights[weights.length - 1].weight : profile.weight;
  const bmr = profile.sex === "male"
    ? 10 * lastWeight + 6.25 * profile.height - 5 * profile.age + 5
    : 10 * lastWeight + 6.25 * profile.height - 5 * profile.age - 161;
  const tdeeBase = bmr * (ACTIVITY_MULT[profile.activity] || 1.375);
  const exCals = todayEx.reduce((s, e) => s + (Number(e.estimatedCalories) || 0), 0);
  const tdee = tdeeBase + exCals;
  const balance = tdee - totals.calories;
  const steps = Math.max(0, ...todayEx.map((e) => e.steps || 0), 0);

  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const trend = last7.map((k) => {
    const w = weights.find((x) => x.date === k);
    return { date: k.slice(5), weight: w ? w.weight : null };
  });

  const targets = {
    calories: profile.calorieTarget, carbs: profile.carbTarget, fiber: profile.fiberTarget,
    protein: profile.proteinTarget, fat: profile.fatTarget,
  };

  return (
    <div>
      {showAdjustmentBanner && (
        <Card style={{ display: "flex", alignItems: "center", gap: 10, borderColor: "#E8A33D" }}>
          {latestAdjustment.newTarget > latestAdjustment.oldTarget ? <TrendingUp size={18} color="#6B8A5A" /> : <TrendingDown size={18} color="#C1442E" />}
          <div style={{ fontSize: 13 }}>
            Budget auto-adjusted to <strong>{latestAdjustment.newTarget} kcal</strong> based on last week's progress
            ({latestAdjustment.actualChange >= 0 ? "+" : ""}{latestAdjustment.actualChange}kg vs a {latestAdjustment.expectedChange}kg goal).
          </div>
        </Card>
      )}
      <SectionTitle eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}>
        Today's dabba
      </SectionTitle>
      <Card style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <DabbaGauge values={totals} targets={targets} />
        <div style={{ flex: 1 }}>
          <MacroList values={totals} targets={targets} />
        </div>
      </Card>

      <div className="stat-grid">
        <Card>
          <div className="stat-label">Energy balance</div>
          <div className="stat-value" style={{ color: balance >= 0 ? "#6B8A5A" : "#C1442E" }}>
            {balance >= 0 ? "−" : "+"}{Math.abs(round(balance))} <span className="stat-unit">kcal</span>
          </div>
          <div className="stat-sub">{balance >= 0 ? "estimated deficit" : "estimated surplus"} · TDEE ~{round(tdee)}</div>
        </Card>
        <Card>
          <div className="stat-label">Weight</div>
          <div className="stat-value">{lastWeight} <span className="stat-unit">kg</span></div>
          <div className="stat-sub">{weights.length ? `last logged ${labelForKey(weights[weights.length - 1].date).toLowerCase()}` : "no logs yet"}</div>
        </Card>
      </div>

      <Card>
        <div className="stat-label">Sleep last night</div>
        <div className="stat-value">{todaySleep ? todaySleep.hours : "—"} <span className="stat-unit">{todaySleep ? "hrs" : ""}</span></div>
        <div className="stat-sub">{todaySleep ? todaySleep.quality : "not logged yet"}</div>
      </Card>

      {steps > 0 && (
        <Card>
          <div className="stat-label">Steps today</div>
          <div className="stat-value">{steps.toLocaleString()}</div>
        </Card>
      )}

      <SectionTitle eyebrow="Last 7 days">Weight trend</SectionTitle>
      <Card>
        <div style={{ width: "100%", height: 140 }}>
          <ResponsiveContainer>
            <LineChart data={trend} margin={{ top: 6, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#3A342C" vertical={false} />
              <XAxis dataKey="date" stroke="#8A8375" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#8A8375" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "#2B2723", border: "1px solid #4A443C", borderRadius: 8, color: "#F2EEE6" }} />
              <Line type="monotone" dataKey="weight" stroke="#E8A33D" strokeWidth={2} dot={{ r: 3, fill: "#E8A33D" }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Log Meal / Exercise                                                   */
/* ---------------------------------------------------------------------- */

function LogScreen({ customFoods, onSaveMeal, onSaveExercise, onSaveSleep, onAddCustomFood }) {
  const [mode, setMode] = useState("food");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [memoryPrompt, setMemoryPrompt] = useState(null); // { suggestedName, suggestedDesc }

  const parse = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(""); setDraft(null);
    try {
      if (mode === "food") {
        const parsed = await parseMealWithAI(text, customFoods);
        setDraft(parsed);
      } else if (mode === "exercise") {
        const parsed = await parseExerciseWithAI(text);
        setDraft(parsed);
      } else {
        const parsed = await parseSleepWithAI(text);
        setDraft(parsed);
      }
    } catch (e) {
      setError("Couldn't parse that — try rephrasing, or check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (idx, field, val) => {
    setDraft((d) => {
      const items = [...d.items];
      items[idx] = { ...items[idx], [field]: field === "name" || field === "quantity" ? val : Number(val) };
      const totals = { calories: 0, carbs: 0, fiber: 0, protein: 0, fat: 0 };
      items.forEach((it) => MACROS.forEach(({ key }) => { totals[key] += Number(it[key]) || 0; }));
      return { ...d, items, totals };
    });
  };

  const save = () => {
    if (mode === "food") {
      onSaveMeal({ id: uid(), mealType: draft.mealType, rawText: text, items: draft.items, totals: draft.totals, micros: draft.micros, note: draft.note, time: new Date().toISOString() });
      const already = customFoods.some((f) => f.name.toLowerCase() === text.trim().toLowerCase());
      if (!already) {
        setMemoryPrompt({
          suggestedName: draft.items.length === 1 ? draft.items[0].name : `${draft.mealType} — ${draft.items.map((i) => i.name).join(", ")}`.slice(0, 60),
          suggestedDesc: text.trim(),
        });
      }
    } else if (mode === "exercise") {
      onSaveExercise({ id: uid(), rawText: text, summary: draft.summary, durationMinutes: draft.durationMinutes, steps: draft.steps, estimatedCalories: draft.estimatedCalories, entries: draft.entries, time: new Date().toISOString() });
    } else {
      onSaveSleep({ date: todayKey(), hours: draft.hours, quality: draft.quality, bedtime: draft.bedtime, wakeTime: draft.wakeTime, note: draft.note, rawText: text });
    }
    setText(""); setDraft(null);
  };

  const confirmMemory = (name, description) => {
    onAddCustomFood({ id: uid(), name, description });
    setMemoryPrompt(null);
  };

  return (
    <div>
      <div className="pill-tabs">
        <button className={mode === "food" ? "pill active" : "pill"} onClick={() => { setMode("food"); setDraft(null); }}>
          <Utensils size={14} /> Food
        </button>
        <button className={mode === "exercise" ? "pill active" : "pill"} onClick={() => { setMode("exercise"); setDraft(null); }}>
          <Dumbbell size={14} /> Exercise
        </button>
        <button className={mode === "sleep" ? "pill active" : "pill"} onClick={() => { setMode("sleep"); setDraft(null); }}>
          <Moon size={14} /> Sleep
        </button>
      </div>

      <SectionTitle eyebrow={mode === "food" ? "Tell it what you ate" : mode === "exercise" ? "Tell it what you did" : "Tell it how you slept"}>
        {mode === "food" ? "Log a meal" : mode === "exercise" ? "Log activity" : "Log sleep"}
      </SectionTitle>
      <Card>
        <textarea
          className="dabba-textarea"
          rows={4}
          placeholder={mode === "food"
            ? "e.g. 200g boiled chana with tadka, 2 chapati, 100g paneer, 20g yogurt with 20g honey"
            : mode === "exercise"
            ? "e.g. Chest day — dumbbell bench press 3x10, incline push-ups 3x15, total 1h20m. Or: walked 8,000 steps."
            : "e.g. Slept around 11:15pm, woke up twice, up at 6:30am feeling okay."}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn-primary" onClick={parse} disabled={loading || !text.trim()}>
          {loading ? <Loader2 size={16} className="spin" /> : <MessageSquarePlus size={16} />}
          {loading ? "Reading…" : "Parse"}
        </button>
        {error && <div className="error-text"><AlertCircle size={14} /> {error}</div>}
      </Card>

      {draft && mode === "food" && (
        <Card>
          <div className="eyebrow">{draft.mealType} · estimate</div>
          {draft.items.map((it, idx) => (
            <div className="item-row" key={idx}>
              <div className="item-name">{it.name} <span className="item-qty">{it.quantity}</span></div>
              <div className="item-macros">
                {MACROS.map((m) => (
                  <input
                    key={m.key}
                    className="mini-input"
                    type="number"
                    value={it[m.key]}
                    onChange={(e) => updateItem(idx, m.key, e.target.value)}
                    title={m.label}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="item-macros-header">
            {MACROS.map((m) => <span key={m.key}>{m.label.slice(0, 4)}</span>)}
          </div>
          <MacroList values={draft.totals} />
          <div className="note-text" style={{ marginBottom: 0 }}>Micronutrients estimated too — see weekly coverage in Reports.</div>
          {draft.note && <div className="note-text">{draft.note}</div>}
          <button className="btn-primary" onClick={save}><Check size={16} /> Save meal</button>
        </Card>
      )}

      {draft && mode === "exercise" && (
        <Card>
          <div className="eyebrow">{draft.source === "device-reported" ? "device-reported" : "app-estimated"}</div>
          <div className="section-title" style={{ fontSize: 16 }}>{draft.summary}</div>
          {draft.entries?.map((en, i) => (
            <div key={i} className="ex-entry">{en.exercise}{en.sets ? ` — ${en.sets}×${en.reps || "?"}` : ""}</div>
          ))}
          <div className="macro-row"><Dumbbell size={14} /> <span className="macro-label">Calories burned</span><span className="macro-val">{round(draft.estimatedCalories)} kcal</span></div>
          {draft.durationMinutes ? <div className="macro-row"><span className="macro-label">Duration</span><span className="macro-val">{draft.durationMinutes} min</span></div> : null}
          {draft.steps ? <div className="macro-row"><Footprints size={14} /><span className="macro-label">Steps</span><span className="macro-val">{draft.steps}</span></div> : null}
          <button className="btn-primary" onClick={save}><Check size={16} /> Save activity</button>
        </Card>
      )}

      {draft && mode === "sleep" && (
        <Card>
          <div className="eyebrow">{draft.quality}</div>
          <div className="section-title" style={{ fontSize: 16 }}>{draft.hours} hours</div>
          {(draft.bedtime || draft.wakeTime) && (
            <div className="stat-sub">{draft.bedtime || "?"} → {draft.wakeTime || "?"}</div>
          )}
          {draft.note && <div className="note-text">{draft.note}</div>}
          <button className="btn-primary" onClick={save}><Check size={16} /> Save sleep</button>
        </Card>
      )}

      {memoryPrompt && (
        <SaveMemoryModal
          initialName={memoryPrompt.suggestedName}
          initialDesc={memoryPrompt.suggestedDesc}
          onSave={confirmMemory}
          onDismiss={() => setMemoryPrompt(null)}
        />
      )}
    </div>
  );
}

function SaveMemoryModal({ initialName, initialDesc, onSave, onDismiss }) {
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDesc);
  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="section-title" style={{ fontSize: 17, marginBottom: 4 }}>Save meal as food memory?</div>
        <div className="note-text" style={{ marginTop: 0 }}>
          Next time you log this, Forge will remember exactly what it means.
        </div>
        <label className="field-label">Name</label>
        <input className="dabba-input" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="field-label">What it means</label>
        <textarea className="dabba-textarea" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button className="btn-primary" onClick={() => onSave(name.trim(), desc.trim())} disabled={!name.trim() || !desc.trim()}>
          <Check size={16} /> Save to memory
        </button>
        <button className="btn-secondary" onClick={onDismiss}>Not this time</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Daily Summary                                                          */
/* ---------------------------------------------------------------------- */

function DailySummary({ meals, exercise, profile, onDeleteMeal }) {
  const [key, setKey] = useState(todayKey());
  const dayMeals = meals[key] || [];
  const dayEx = exercise[key] || [];
  const totals = sumMeals(dayMeals);
  const targets = {
    calories: profile.calorieTarget, carbs: profile.carbTarget, fiber: profile.fiberTarget,
    protein: profile.proteinTarget, fat: profile.fatTarget,
  };

  return (
    <div>
      <div className="day-nav">
        <button className="icon-btn" onClick={() => setKey(addDays(key, -1))}><ChevronLeft size={18} /></button>
        <div className="day-nav-label">{labelForKey(key)}</div>
        <button className="icon-btn" onClick={() => setKey(addDays(key, 1))} disabled={key >= todayKey()}><ChevronRight size={18} /></button>
      </div>

      <Card style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <DabbaGauge values={totals} targets={targets} size={160} />
        <MacroList values={totals} targets={targets} />
      </Card>

      <SectionTitle eyebrow={`${dayMeals.length} meal${dayMeals.length === 1 ? "" : "s"} logged`}>Meals</SectionTitle>
      {dayMeals.length === 0 && <Card><div className="empty-text">Nothing logged this day yet.</div></Card>}
      {dayMeals.map((m) => (
        <Card key={m.id}>
          <div className="meal-header">
            <span className="eyebrow">{m.mealType}</span>
            <button className="icon-btn" onClick={() => onDeleteMeal(key, m.id)}><Trash2 size={14} /></button>
          </div>
          {m.items.map((it, i) => (
            <div key={i} className="item-row-static">
              <span className="item-name">{it.name} <span className="item-qty">{it.quantity}</span></span>
              <span className="item-cal">{round(it.calories)} kcal</span>
            </div>
          ))}
          <MacroList values={m.totals} />
        </Card>
      ))}

      {dayEx.length > 0 && (
        <>
          <SectionTitle eyebrow="Activity">Exercise</SectionTitle>
          {dayEx.map((e) => (
            <Card key={e.id}>
              <div className="section-title" style={{ fontSize: 15 }}>{e.summary}</div>
              <div className="stat-sub">{round(e.estimatedCalories)} kcal{e.durationMinutes ? ` · ${e.durationMinutes} min` : ""}{e.steps ? ` · ${e.steps} steps` : ""}</div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Weight                                                                 */
/* ---------------------------------------------------------------------- */

function WeightScreen({ weights, onAddWeight, onImportWeights }) {
  const [val, setVal] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState(null); // { date, weight, bodyFatPct, muscleMassKg, bmi }
  const last30 = weights.slice(-30);
  const weekAvg = useMemo(() => {
    const last7 = weights.slice(-7);
    if (!last7.length) return null;
    return round(last7.reduce((s, w) => s + w.weight, 0) / last7.length, 1);
  }, [weights]);
  const prevWeekAvg = useMemo(() => {
    const prior = weights.slice(-14, -7);
    if (!prior.length) return null;
      return round(prior.reduce((s, w) => s + w.weight, 0) / prior.length, 1);
    }, [weights]);
    const latestWithBody = [...weights].reverse().find((w) => w.bodyFatPct != null || w.muscleMassKg != null);

    const submit = () => {
      const w = Number(val);
      if (!w) return;
      onAddWeight({ date: todayKey(), weight: w });
      setVal("");
    };

    const handleFile = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const lines = String(reader.result).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          const rows = [];
          for (const line of lines) {
            const parts = line.split(",").map((p) => p.trim());
            if (parts.length < 2) continue;
            let [rawDate, rawWeight] = parts;
            if (!/^\d/.test(rawDate)) continue;
            const w = parseFloat(rawWeight);
            if (!w) continue;
            const d = new Date(rawDate);
            if (isNaN(d.getTime())) continue;
            rows.push({ date: dateKey(d), weight: w });
          }
          if (rows.length) {
            onImportWeights(rows);
            setImportMsg(`Imported ${rows.length} weigh-ins.`);
          } else {
            setImportMsg("Couldn't find any date,weight rows in that file.");
          }
        } catch (err) {
          setImportMsg("Couldn't read that file.");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    };

    const handleScreenshot = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      setScanLoading(true); setScanError(""); setScanResult(null);
      try {
        const r = await parseWeightScreenshot(file);
        if (r.weight == null) {
          setScanError("Couldn't find a weight reading in that screenshot — try a clearer crop.");
          return;
        }
        const weightKg = r.weightUnit === "lb" ? round(r.weight * 0.453592, 1) : r.weight;
        setScanResult({
          date: todayKey(), weight: weightKg,
          bodyFatPct: r.bodyFatPct, muscleMassKg: r.muscleMassKg, bmi: r.bmi,
          confidence: r.confidence, note: r.note,
        });
      } catch (err) {
        setScanError("Couldn't read that screenshot — check your connection and try again.");
      } finally {
        setScanLoading(false);
      }
    };

    const confirmScan = () => {
      onAddWeight(scanResult);
      setScanResult(null);
    };

    return (
      <div>
        <SectionTitle eyebrow="Log">Today's weight</SectionTitle>
        <Card>
          <div style={{ display: "flex", gap: 10 }}>
            <input className="dabba-input" type="number" step="0.1" placeholder="kg" value={val} onChange={(e) => setVal(e.target.value)} />
            <button className="btn-primary" style={{ width: "auto" }} onClick={submit}><Plus size={16} /> Log</button>
          </div>
          <label className="btn-secondary" style={{ cursor: "pointer" }}>
            {scanLoading ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
            {scanLoading ? "Reading screenshot…" : "Scan a Dr.Trust 360 screenshot"}
            <input type="file" accept="image/*" onChange={handleScreenshot} style={{ display: "none" }} disabled={scanLoading} />
          </label>
          <label className="btn-secondary" style={{ cursor: "pointer" }}>
            <Upload size={16} /> Import from CSV (date, weight)
            <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: "none" }} />
          </label>
          {scanError && <div className="error-text"><AlertCircle size={14} /> {scanError}</div>}
          {importMsg && <div className="note-text">{importMsg}</div>}
          <div className="note-text">
            No direct connection to Dr.Trust 360 is possible — it doesn't expose a public API. Scanning a screenshot or importing a CSV export are the closest workarounds.
          </div>
      </Card>

      {scanResult && (
        <Card>
          <div className="eyebrow">{scanResult.confidence} confidence · edit before saving</div>
          <label className="field-label">Date</label>
          <input className="dabba-input" type="date" value={scanResult.date} max={todayKey()} onChange={(e) => setScanResult((s) => ({ ...s, date: e.target.value }))} />
          <label className="field-label">Weight (kg)</label>
          <input className="dabba-input" type="number" step="0.1" value={scanResult.weight} onChange={(e) => setScanResult((s) => ({ ...s, weight: Number(e.target.value) }))} />
          {scanResult.bodyFatPct != null && (
            <>
              <label className="field-label">Body fat (%)</label>
              <input className="dabba-input" type="number" step="0.1" value={scanResult.bodyFatPct} onChange={(e) => setScanResult((s) => ({ ...s, bodyFatPct: Number(e.target.value) }))} />
            </>
          )}
          {scanResult.muscleMassKg != null && (
            <>
              <label className="field-label">Muscle mass (kg)</label>
              <input className="dabba-input" type="number" step="0.1" value={scanResult.muscleMassKg} onChange={(e) => setScanResult((s) => ({ ...s, muscleMassKg: Number(e.target.value) }))} />
            </>
          )}
          {scanResult.note && <div className="note-text">{scanResult.note}</div>}
          <button className="btn-primary" onClick={confirmScan}><Check size={16} /> Save this reading</button>
          <button className="btn-secondary" onClick={() => setScanResult(null)}>Discard</button>
        </Card>
      )}

      <div className="stat-grid">
        <Card>
          <div className="stat-label">Weekly average</div>
          <div className="stat-value">{weekAvg ?? "—"} <span className="stat-unit">kg</span></div>
          {weekAvg != null && prevWeekAvg != null && (
            <div className="stat-sub">{weekAvg - prevWeekAvg >= 0 ? "+" : ""}{round(weekAvg - prevWeekAvg, 1)} kg vs prior week</div>
          )}
        </Card>
        <Card>
          <div className="stat-label">Latest</div>
          <div className="stat-value">{weights.length ? weights[weights.length - 1].weight : "—"} <span className="stat-unit">kg</span></div>
          <div className="stat-sub">{weights.length ? labelForKey(weights[weights.length - 1].date) : "no logs yet"}</div>
        </Card>
      </div>

      {latestWithBody && (
        <div className="stat-grid">
          {latestWithBody.bodyFatPct != null && (
            <Card>
              <div className="stat-label">Body fat</div>
              <div className="stat-value">{latestWithBody.bodyFatPct} <span className="stat-unit">%</span></div>
              <div className="stat-sub">from {labelForKey(latestWithBody.date).toLowerCase()}'s scan</div>
            </Card>
          )}
          {latestWithBody.muscleMassKg != null && (
            <Card>
              <div className="stat-label">Muscle mass</div>
              <div className="stat-value">{latestWithBody.muscleMassKg} <span className="stat-unit">kg</span></div>
              <div className="stat-sub">from {labelForKey(latestWithBody.date).toLowerCase()}'s scan</div>
            </Card>
          )}
        </div>
      )}

      <SectionTitle eyebrow="Last 30 logs">Trend</SectionTitle>
      <Card>
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer>
            <LineChart data={last30.map((w) => ({ date: w.date.slice(5), weight: w.weight }))} margin={{ top: 6, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#3A342C" vertical={false} />
              <XAxis dataKey="date" stroke="#8A8375" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#8A8375" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "#2B2723", border: "1px solid #4A443C", borderRadius: 8, color: "#F2EEE6" }} />
              <Line type="monotone" dataKey="weight" stroke="#A24B5E" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="note-text" style={{ marginTop: 4 }}>
        Day-to-day swings are usually water, sodium, glycogen or bowel contents — not fat. Trust the weekly average over any single number.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Weekly Insights                                                        */
/* ---------------------------------------------------------------------- */

const PERIODS = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
];

function ReportsScreen({ meals, weights, exercise, sleep, profile }) {
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [customStart, setCustomStart] = useState(addDays(todayKey(), -13));
  const [customEnd, setCustomEnd] = useState(todayKey());
  const [aiText, setAiText] = useState("");
  const [loading, setLoading] = useState(false);

  const dates = periodDates(period, offset, customStart, customEnd);
  const label = periodLabel(period, offset, dates, customStart, customEnd);

  const dayRows = dates.map((k) => ({ date: k, ...sumMeals(meals[k] || []), micros: sumMicros(meals[k] || []), logged: (meals[k] || []).length > 0 }));
  const loggedDays = dayRows.filter((d) => d.logged);
  const avg = (field) => loggedDays.length ? round(loggedDays.reduce((s, d) => s + d[field], 0) / loggedDays.length, 1) : 0;
  const avgMicro = (key) => loggedDays.length ? round(loggedDays.reduce((s, d) => s + (d.micros[key] || 0), 0) / loggedDays.length, 1) : 0;
  const microAverages = useMemo(() => {
    const out = {};
    MICROS.forEach((m) => { out[m.key] = avgMicro(m.key); });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(dayRows.map((d) => d.micros))]);

  const sleepDays = dates.map((k) => sleep[k]).filter(Boolean);
  const avgSleepHours = sleepDays.length ? round(sleepDays.reduce((s, x) => s + (Number(x.hours) || 0), 0) / sleepDays.length, 1) : null;

  const rangeWeights = weights.filter((w) => dates.includes(w.date));
  const startW = rangeWeights[0]?.weight;
  const endW = rangeWeights[rangeWeights.length - 1]?.weight;

  const bmr = profile.sex === "male"
    ? 10 * (profile.weight) + 6.25 * profile.height - 5 * profile.age + 5
    : 10 * (profile.weight) + 6.25 * profile.height - 5 * profile.age - 161;
  const tdeeBase = bmr * (ACTIVITY_MULT[profile.activity] || 1.375);
  const totalExCals = dates.reduce((s, k) => s + (exercise[k] || []).reduce((a, e) => a + (Number(e.estimatedCalories) || 0), 0), 0);
  const avgExCals = dates.length ? totalExCals / dates.length : 0;
  const avgBalance = round(tdeeBase + avgExCals - avg("calories"));

  const chartData = bucketRange(dates, meals, 12);

  useEffect(() => { setAiText(""); }, [period, offset, customStart, customEnd]);

  const generate = async () => {
    setLoading(true);
    try {
      const text = await generateWeeklyInsight({
        period, range: label,
        loggedDays: loggedDays.length, totalDays: dates.length,
        avgCalories: avg("calories"), avgCarbs: avg("carbs"), avgFiber: avg("fiber"),
        avgProtein: avg("protein"), avgFat: avg("fat"),
        calorieTarget: profile.calorieTarget, proteinTarget: profile.proteinTarget,
        avgEstimatedDailyBalance: avgBalance,
        weightStart: startW, weightEnd: endW,
        avgSleepHours,
        microAverages: MICROS.reduce((o, m) => ({ ...o, [m.label]: `${microAverages[m.key]}${m.unit} (${round((microAverages[m.key] / m.rda) * 100)}% of typical RDA)` }), {}),
      });
      setAiText(text);
    } catch (e) {
      setAiText("Couldn't generate insights right now — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="pill-tabs">
        {PERIODS.map((p) => (
          <button key={p.key} className={period === p.key ? "pill active" : "pill"} onClick={() => { setPeriod(p.key); setOffset(0); }}>
            {p.label}
          </button>
        ))}
      </div>

      {period === "custom" ? (
        <Card style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">From</label>
            <input className="dabba-input" type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">To</label>
            <input className="dabba-input" type="date" value={customEnd} min={customStart} max={todayKey()} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        </Card>
      ) : (
        <div className="day-nav">
          <button className="icon-btn" onClick={() => setOffset((o) => o - 1)}><ChevronLeft size={18} /></button>
          <div className="day-nav-label">{label}</div>
          <button className="icon-btn" onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0}><ChevronRight size={18} /></button>
        </div>
      )}

      <SectionTitle eyebrow={`${loggedDays.length}/${dates.length} days logged`}>Averages</SectionTitle>
      <Card>
        <MacroList values={{ calories: avg("calories"), carbs: avg("carbs"), fiber: avg("fiber"), protein: avg("protein"), fat: avg("fat") }}
          targets={{ calories: profile.calorieTarget, carbs: profile.carbTarget, fiber: profile.fiberTarget, protein: profile.proteinTarget, fat: profile.fatTarget }} />
      </Card>

      <div className="stat-grid">
        <Card>
          <div className="stat-label">Avg daily balance</div>
          <div className="stat-value" style={{ color: avgBalance >= 0 ? "#6B8A5A" : "#C1442E" }}>
            {avgBalance >= 0 ? "−" : "+"}{Math.abs(avgBalance)} <span className="stat-unit">kcal</span>
          </div>
        </Card>
        <Card>
          <div className="stat-label">Weight change</div>
          <div className="stat-value">{startW != null && endW != null ? `${endW - startW >= 0 ? "+" : ""}${round(endW - startW, 1)}` : "—"} <span className="stat-unit">kg</span></div>
        </Card>
      </div>

      <Card>
        <div className="stat-label">Avg sleep</div>
        <div className="stat-value">{avgSleepHours ?? "—"} <span className="stat-unit">{avgSleepHours ? "hrs/night" : ""}</span></div>
        <div className="stat-sub">{sleepDays.length}/{dates.length} nights logged</div>
      </Card>

      <SectionTitle eyebrow="Weekly avg vs typical RDA">Micronutrient coverage</SectionTitle>
      <Card>
        {loggedDays.length === 0 ? (
          <div className="empty-text">Log some meals in this range to see coverage.</div>
        ) : (
          <MicroList values={microAverages} />
        )}
      </Card>

      <SectionTitle eyebrow="Calories logged">Trend</SectionTitle>
      <Card>
        <div style={{ width: "100%", height: 150 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid stroke="#3A342C" vertical={false} />
              <XAxis dataKey="label" stroke="#8A8375" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#8A8375" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#2B2723", border: "1px solid #4A443C", borderRadius: 8, color: "#F2EEE6" }} />
              <Bar dataKey="calories" fill="#E8A33D" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <SectionTitle eyebrow="AI coach">Notes</SectionTitle>
      <Card>
        {!aiText && (
          <button className="btn-primary" onClick={generate} disabled={loading || loggedDays.length === 0}>
            {loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {loading ? "Thinking…" : loggedDays.length === 0 ? "Log some days first" : `Generate notes for this ${period}`}
          </button>
        )}
        {aiText && <div className="ai-note">{aiText}</div>}
        {aiText && (
          <button className="btn-secondary" onClick={generate} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Regenerate
          </button>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Profile / Settings                                                     */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/*  Chat — ask the AI your doubts                                          */
/* ---------------------------------------------------------------------- */

function ChatPane({ history, onSend, persona, contextSummary, placeholder, emptyHint }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user", content: text.trim() };
    const nextHistory = [...history, userMsg];
    onSend(nextHistory);
    setText(""); setLoading(true); setError("");
    try {
      const reply = await chatWithAI(persona, history, contextSummary, userMsg.content);
      onSend([...nextHistory, { role: "assistant", content: reply }]);
    } catch (e) {
      setError("Couldn't reach the coach — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Card>
        {history.length === 0 && <div className="empty-text">{emptyHint}</div>}
        <div className="chat-log">
          {history.map((m, i) => (
            <div key={i} className={m.role === "user" ? "chat-bubble user" : "chat-bubble assistant"}>
              {m.content}
            </div>
          ))}
          {loading && <div className="chat-bubble assistant"><Loader2 size={14} className="spin" /></div>}
        </div>
        {error && <div className="error-text"><AlertCircle size={14} /> {error}</div>}
      </Card>
      <div className="chat-input-row">
        <input
          className="dabba-input"
          style={{ marginBottom: 0 }}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button className="icon-btn send-btn" onClick={send} disabled={loading || !text.trim()}><Send size={18} /></button>
      </div>
    </div>
  );
}

function ChatScreen({ nutritionHistory, exerciseHistory, onSendNutrition, onSendExercise, profile, meals, weights, exercise, sleep }) {
  const [coach, setCoach] = useState("nutrition");

  const nutritionContext = useMemo(() => {
    const today = todayKey();
    const todayTotals = sumMeals(meals[today] || []);
    const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const loggedLast7 = last7.filter((k) => (meals[k] || []).length > 0);
    const avgCal = loggedLast7.length
      ? round(loggedLast7.reduce((s, k) => s + sumMeals(meals[k]).calories, 0) / loggedLast7.length)
      : null;
    const lastWeight = weights.length ? weights[weights.length - 1] : null;
    const lastSleep = sleep[today] || sleep[addDays(today, -1)];
    return [
      `Profile: ${profile.age}y ${profile.sex}, ${profile.height}cm, ${profile.weight}kg, activity=${profile.activity}, goal=${profile.goalType} at ${profile.weeklyRateGoal}kg/week.`,
      `Targets: ${profile.calorieTarget} kcal, ${profile.proteinTarget}g protein, ${profile.carbTarget}g carbs, ${profile.fiberTarget}g fiber, ${profile.fatTarget}g fat.`,
      `Today so far: ${round(todayTotals.calories)} kcal, ${round(todayTotals.protein)}g protein.`,
      avgCal != null ? `Last 7 days avg calories: ${avgCal} kcal (${loggedLast7.length}/7 days logged).` : `Not much logged in the last 7 days.`,
      lastWeight ? `Latest weight: ${lastWeight.weight}kg on ${lastWeight.date}.` : `No weight logged yet.`,
      lastSleep ? `Recent sleep: ${lastSleep.hours}hrs, ${lastSleep.quality}.` : `No sleep logged recently.`,
    ].join("\n");
  }, [profile, meals, weights, sleep]);

  const exerciseContext = useMemo(() => {
    const today = todayKey();
    const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const workouts = last7.flatMap((k) => (exercise[k] || []).map((e) => `${k}: ${e.summary} (~${round(e.estimatedCalories)} kcal${e.durationMinutes ? `, ${e.durationMinutes}min` : ""})`));
    const avgSleep7 = (() => {
      const nights = last7.map((k) => sleep[k]).filter(Boolean);
      return nights.length ? round(nights.reduce((s, n) => s + (Number(n.hours) || 0), 0) / nights.length, 1) : null;
    })();
    const lastWeight = weights.length ? weights[weights.length - 1] : null;
    return [
      `Profile: ${profile.age}y ${profile.sex}, goal=${profile.goalType} at ${profile.weeklyRateGoal}kg/week, baseline activity=${profile.activity}.`,
      lastWeight ? `Latest weight: ${lastWeight.weight}kg on ${lastWeight.date}.` : `No weight logged yet.`,
      avgSleep7 != null ? `Avg sleep last 7 nights: ${avgSleep7} hrs.` : `No recent sleep logged.`,
      workouts.length ? `Logged workouts, last 7 days:\n${workouts.join("\n")}` : `No workouts logged in the last 7 days.`,
    ].join("\n");
  }, [profile, exercise, sleep, weights]);

  return (
    <div>
      <div className="pill-tabs">
        <button className={coach === "nutrition" ? "pill active" : "pill"} onClick={() => setCoach("nutrition")}>
          <Utensils size={14} /> Nutrition
        </button>
        <button className={coach === "exercise" ? "pill active" : "pill"} onClick={() => setCoach("exercise")}>
          <Dumbbell size={14} /> Exercise
        </button>
      </div>
      <SectionTitle eyebrow="Ask anything">{coach === "nutrition" ? "Nutrition coach" : "Exercise coach"}</SectionTitle>
      {coach === "nutrition" ? (
        <ChatPane
          history={nutritionHistory} onSend={onSendNutrition}
          persona={NUTRITION_PERSONA} contextSummary={nutritionContext}
          placeholder="Ask about food, macros, your targets…"
          emptyHint="Ask about your macros, a food you're unsure how to log, whether today's meals fit your goal — anything."
        />
      ) : (
        <ChatPane
          history={exerciseHistory} onSend={onSendExercise}
          persona={EXERCISE_PERSONA} contextSummary={exerciseContext}
          placeholder="Ask about your circuit, recovery, progression…"
          emptyHint="Ask about structuring your weekly split, swapping an exercise, whether you're overtraining, or how to progress a lift."
        />
      )}
    </div>
  );
}

function ProfileScreen({ profile, onUpdateProfile, customFoods, onAddCustomFood, onDeleteCustomFood, budgetLog }) {
  const [form, setForm] = useState(profile);
  const [foodName, setFoodName] = useState("");
  const [foodDesc, setFoodDesc] = useState("");

  useEffect(() => setForm(profile), [profile]);

  const field = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const livePreview = useMemo(() => computeAutoTargets(form, form.weight), [form.sex, form.age, form.height, form.weight, form.activity, form.goalType, form.weeklyRateGoal, form.calorieFloor, form.calorieCeiling]);

  const save = () => {
    const thisWeekStart = startOfWeek(todayKey());
    if (form.autoTargets) {
      onUpdateProfile({ ...form, ...livePreview, targetsInitialized: true, lastAdjustmentWeek: thisWeekStart });
    } else {
      onUpdateProfile({ ...form, lastAdjustmentWeek: thisWeekStart });
    }
  };

  const addFood = () => {
    if (!foodName.trim() || !foodDesc.trim()) return;
    onAddCustomFood({ id: uid(), name: foodName.trim(), description: foodDesc.trim() });
    setFoodName(""); setFoodDesc("");
  };

  return (
    <div>
      <SectionTitle eyebrow="You">Profile</SectionTitle>
      <Card>
        <label className="field-label">Age</label>
        <input className="dabba-input" type="number" value={form.age} onChange={(e) => field("age", Number(e.target.value))} />
        <label className="field-label">Sex</label>
        <select className="dabba-select" value={form.sex} onChange={(e) => field("sex", e.target.value)}>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <label className="field-label">Height (cm)</label>
        <input className="dabba-input" type="number" value={form.height} onChange={(e) => field("height", Number(e.target.value))} />
        <label className="field-label">Current weight (kg)</label>
        <input className="dabba-input" type="number" step="0.1" value={form.weight} onChange={(e) => field("weight", Number(e.target.value))} />
        <label className="field-label">Baseline activity (excludes logged exercise)</label>
        <select className="dabba-select" value={form.activity} onChange={(e) => field("activity", e.target.value)}>
          <option value="sedentary">Sedentary — desk job, little movement</option>
          <option value="light">Light — some daily walking</option>
          <option value="moderate">Moderate — on your feet a fair bit</option>
          <option value="active">Active — physically demanding day</option>
        </select>
        <label className="field-label">Goal</label>
        <select className="dabba-select" value={form.goalType} onChange={(e) => field("goalType", e.target.value)}>
          <option value="lose">Lose weight</option>
          <option value="maintain">Maintain</option>
          <option value="gain">Gain weight</option>
        </select>
        <label className="field-label">Target rate (kg/week)</label>
        <input className="dabba-input" type="number" step="0.1" value={form.weeklyRateGoal} onChange={(e) => field("weeklyRateGoal", Number(e.target.value))} />
      </Card>

      <SectionTitle eyebrow="Daily targets">Goals</SectionTitle>
      <Card>
        <button
          className={form.autoTargets ? "pill active" : "pill"}
          style={{ width: "100%", marginBottom: 10 }}
          onClick={() => field("autoTargets", !form.autoTargets)}
        >
          {form.autoTargets ? <Check size={14} /> : <X size={14} />} Calculate from my profile {form.autoTargets ? "ON" : "OFF"}
        </button>

        {form.autoTargets ? (
          <>
            <div className="note-text" style={{ marginTop: 0 }}>
              From your BMR (~{livePreview.bmr} kcal) and activity level, TDEE is ~{livePreview.tdee} kcal. These targets bake in your {form.goalType} goal at {form.weeklyRateGoal}kg/week, updated live as you edit your profile above:
            </div>
            <MacroList values={{ calories: livePreview.calorieTarget, carbs: livePreview.carbTarget, fiber: livePreview.fiberTarget, protein: livePreview.proteinTarget, fat: livePreview.fatTarget }} />
          </>
        ) : (
          <>
            <div className="note-text" style={{ marginTop: 0 }}>Set your own targets — auto-calculation is off.</div>
            {[
              ["calorieTarget", "Calories (kcal)"], ["carbTarget", "Carbs (g)"], ["fiberTarget", "Fiber (g)"],
              ["proteinTarget", "Protein (g)"], ["fatTarget", "Fat (g)"],
            ].map(([k, label]) => (
              <React.Fragment key={k}>
                <label className="field-label">{label}</label>
                <input className="dabba-input" type="number" value={form[k]} onChange={(e) => field(k, Number(e.target.value))} />
              </React.Fragment>
            ))}
          </>
        )}
        <button className="btn-primary" onClick={save}><Check size={16} /> Save profile</button>
      </Card>

      <SectionTitle eyebrow="Autopilot">Weekly progress adjustment</SectionTitle>
      <Card>
        <div className="note-text" style={{ marginTop: 0 }}>
          At the start of each week, compares your last two weekly-average weigh-ins against your goal pace and nudges your calorie target — capped at ±150 kcal/day per week, and within the floor/ceiling below. Works alongside the profile-based calculation above, or on top of a manual target if that's off.
        </div>
        <button
          className={form.adaptiveBudget ? "pill active" : "pill"}
          style={{ width: "100%", marginBottom: 10 }}
          onClick={() => field("adaptiveBudget", !form.adaptiveBudget)}
        >
          {form.adaptiveBudget ? <Check size={14} /> : <X size={14} />} Weekly nudge {form.adaptiveBudget ? "ON" : "OFF"}
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Floor (kcal)</label>
            <input className="dabba-input" type="number" value={form.calorieFloor} onChange={(e) => field("calorieFloor", Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Ceiling (kcal)</label>
            <input className="dabba-input" type="number" value={form.calorieCeiling} onChange={(e) => field("calorieCeiling", Number(e.target.value))} />
          </div>
        </div>
        <button className="btn-primary" onClick={save}><Check size={16} /> Save profile</button>
        {budgetLog.length > 0 && (
          <>
            <div className="field-label" style={{ marginTop: 12 }}>Recent adjustments</div>
            {budgetLog.slice(-5).reverse().map((b) => (
              <div key={b.id} className="custom-food-row">
                <div>
                  <div className="item-name">{b.oldTarget} → {b.newTarget} kcal</div>
                  <div className="stat-sub">week of {b.weekStart} · {b.actualChange >= 0 ? "+" : ""}{b.actualChange}kg vs {b.expectedChange}kg goal</div>
                </div>
              </div>
            ))}
          </>
        )}
      </Card>

      <SectionTitle eyebrow={`${customFoods.length} saved`}>Your food memory</SectionTitle>
      <Card>
        <div className="field-label">e.g. "My buttermilk" → "curd + water in a 1:4 ratio"</div>
        <input className="dabba-input" placeholder="Name (e.g. My buttermilk)" value={foodName} onChange={(e) => setFoodName(e.target.value)} />
        <input className="dabba-input" placeholder="Description used for parsing" value={foodDesc} onChange={(e) => setFoodDesc(e.target.value)} />
        <button className="btn-secondary" onClick={addFood}><Plus size={16} /> Save food</button>
        {customFoods.map((f) => (
          <div key={f.id} className="custom-food-row">
            <div>
              <div className="item-name">{f.name}</div>
              <div className="stat-sub">{f.description}</div>
            </div>
            <button className="icon-btn" onClick={() => onDeleteCustomFood(f.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  App shell                                                              */
/* ---------------------------------------------------------------------- */

const TABS = [
  { key: "dashboard", label: "Today", icon: Home },
  { key: "log", label: "Log", icon: MessageSquarePlus },
  { key: "summary", label: "Summary", icon: ClipboardList },
  { key: "insights", label: "Reports", icon: Sparkles },
];
const MORE_TABS = [
  { key: "weight", label: "Weight", icon: Scale },
  { key: "chat", label: "Chat with coach", icon: MessageCircle },
  { key: "profile", label: "Profile & goals", icon: Settings2 },
];

export default function DabbaTracker() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [meals, setMeals] = useState({});
  const [weights, setWeights] = useState([]);
  const [exercise, setExercise] = useState({});
  const [customFoods, setCustomFoods] = useState([]);
  const [budgetLog, setBudgetLog] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [exerciseChatHistory, setExerciseChatHistory] = useState([]);
  const [sleep, setSleep] = useState({});

  // Mobile keyboards cover the input without resizing the page, so the field
  // being typed into can end up hidden. Scroll it into view on focus, and
  // track the visual viewport so the bottom nav rises above the keyboard
  // instead of sitting underneath it.
  useEffect(() => {
    const handleFocus = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
      }
    };
    document.addEventListener("focusin", handleFocus);

    const vv = window.visualViewport;
    const handleViewport = () => {
      if (!vv) return;
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      document.documentElement.style.setProperty("--kb-offset", `${Math.max(0, Math.round(offset))}px`);
    };
    if (vv) {
      vv.addEventListener("resize", handleViewport);
      vv.addEventListener("scroll", handleViewport);
      handleViewport();
    }
    return () => {
      document.removeEventListener("focusin", handleFocus);
      if (vv) {
        vv.removeEventListener("resize", handleViewport);
        vv.removeEventListener("scroll", handleViewport);
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      const all = await loadAll();
      if (all["dabba:profile"]) setProfile({ ...DEFAULT_PROFILE, ...all["dabba:profile"] });
      if (all["dabba:meals"]) setMeals(all["dabba:meals"]);
      if (all["dabba:weights"]) setWeights(all["dabba:weights"]);
      if (all["dabba:exercise"]) setExercise(all["dabba:exercise"]);
      if (all["dabba:customFoods"]) setCustomFoods(all["dabba:customFoods"]);
      if (all["dabba:budgetLog"]) setBudgetLog(all["dabba:budgetLog"]);
      if (all["dabba:chatHistory"]) setChatHistory(all["dabba:chatHistory"]);
      if (all["dabba:exerciseChatHistory"]) setExerciseChatHistory(all["dabba:exerciseChatHistory"]);
      if (all["dabba:sleep"]) setSleep(all["dabba:sleep"]);
      setReady(true);
    })();
  }, []);

  // Sets initial targets from the profile on first load, then once per week
  // either recomputes them from BMR/TDEE (auto mode) or nudges the existing
  // manual target — in both cases weighing in last week's actual progress.
  useEffect(() => {
    if (!ready) return;
    const thisWeekStart = startOfWeek(todayKey());

    if (!profile.targetsInitialized) {
      const base = computeAutoTargets(profile, profile.weight);
      const updatedProfile = profile.autoTargets
        ? { ...profile, ...base, targetsInitialized: true, lastAdjustmentWeek: thisWeekStart }
        : { ...profile, targetsInitialized: true, lastAdjustmentWeek: thisWeekStart };
      setProfile(updatedProfile);
      save("dabba:profile", updatedProfile);
      return;
    }

    if (profile.lastAdjustmentWeek === thisWeekStart) return;

    if (profile.autoTargets) {
      const { targets, adjustment } = computeWeeklyTargetUpdate(profile, weights);
      const updatedProfile = { ...profile, ...targets, lastAdjustmentWeek: thisWeekStart };
      setProfile(updatedProfile);
      save("dabba:profile", updatedProfile);
      if (adjustment) {
        setBudgetLog((prev) => {
          const next = [...prev, adjustment];
          save("dabba:budgetLog", next);
          return next;
        });
      }
    } else {
      const adjustment = computeBudgetAdjustment(profile, weights);
      const updatedProfile = { ...profile, lastAdjustmentWeek: thisWeekStart };
      if (adjustment) {
        updatedProfile.calorieTarget = adjustment.newTarget;
        setBudgetLog((prev) => {
          const next = [...prev, adjustment];
          save("dabba:budgetLog", next);
          return next;
        });
      }
      setProfile(updatedProfile);
      save("dabba:profile", updatedProfile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const handleSaveMeal = useCallback((meal) => {
    const key = todayKey();
    setMeals((prev) => {
      const next = { ...prev, [key]: [...(prev[key] || []), meal] };
      save("dabba:meals", next);
      return next;
    });
  }, []);

  const handleDeleteMeal = useCallback((key, id) => {
    setMeals((prev) => {
      const next = { ...prev, [key]: (prev[key] || []).filter((m) => m.id !== id) };
      save("dabba:meals", next);
      return next;
    });
  }, []);

  const handleSaveExercise = useCallback((entry) => {
    const key = todayKey();
    setExercise((prev) => {
      const next = { ...prev, [key]: [...(prev[key] || []), entry] };
      save("dabba:exercise", next);
      return next;
    });
  }, []);

  const handleAddWeight = useCallback((w) => {
    setWeights((prev) => {
      const withoutToday = prev.filter((x) => x.date !== w.date);
      const next = [...withoutToday, w].sort((a, b) => a.date.localeCompare(b.date));
      save("dabba:weights", next);
      return next;
    });
  }, []);

  const handleImportWeights = useCallback((rows) => {
    setWeights((prev) => {
      const map = new Map(prev.map((w) => [w.date, w.weight]));
      rows.forEach((r) => map.set(r.date, r.weight));
      const next = Array.from(map, ([date, weight]) => ({ date, weight })).sort((a, b) => a.date.localeCompare(b.date));
      save("dabba:weights", next);
      return next;
    });
  }, []);

  const handleUpdateProfile = useCallback((p) => {
    setProfile(p);
    save("dabba:profile", p);
  }, []);

  const handleChatUpdate = useCallback((history) => {
    setChatHistory(history);
    save("dabba:chatHistory", history);
  }, []);

  const handleExerciseChatUpdate = useCallback((history) => {
    setExerciseChatHistory(history);
    save("dabba:exerciseChatHistory", history);
  }, []);

  const handleSaveSleep = useCallback((entry) => {
    setSleep((prev) => {
      const next = { ...prev, [entry.date]: entry };
      save("dabba:sleep", next);
      return next;
    });
  }, []);

  const handleAddCustomFood = useCallback((f) => {
    setCustomFoods((prev) => {
      const next = [...prev, f];
      save("dabba:customFoods", next);
      return next;
    });
  }, []);

  const handleDeleteCustomFood = useCallback((id) => {
    setCustomFoods((prev) => {
      const next = prev.filter((f) => f.id !== id);
      save("dabba:customFoods", next);
      return next;
    });
  }, []);

  return (
    <div className="dabba-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Work+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');

        .dabba-root {
          --ink:#1C1A17; --tin:#2B2723; --tin-light:#332D26; --steel:#4A443C;
          --curd:#F2EEE6; --muted:#8A8375; --turmeric:#E8A33D; --chili:#C1442E;
          --coriander:#6B8A5A; --kokum:#A24B5E; --cumin:#8B5E3C; --kb-offset: 0px;
          background: var(--ink);
          color: var(--curd);
          font-family: 'Work Sans', sans-serif;
          font-size: 16px;
          line-height: 1.5;
          min-height: 100vh;
          min-height: 100dvh;
          max-width: 560px;
          margin: 0 auto;
          padding-bottom: 88px;
          box-sizing: border-box;
        }
        .dabba-root * { box-sizing: border-box; }
        .dabba-header {
          padding: 26px 20px 14px;
          display: flex; align-items: baseline; justify-content: space-between;
        }
        .dabba-header h1 {
          font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; margin: 0;
          letter-spacing: -0.02em;
        }
        .dabba-header .tag { font-size: 13px; color: var(--muted); margin-top: 2px; }
        .tab-content { padding: 8px 20px 28px; }
        .eyebrow { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
        .section-title { font-family: 'Fraunces', serif; font-size: 21px; font-weight: 600; margin-top: 3px; margin-bottom: 2px; }
        .dabba-card {
          background: var(--tin); border: 1px solid var(--steel); border-radius: 16px;
          padding: 20px; margin-bottom: 18px;
        }
        .macro-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--tin-light); }
        .macro-row:last-child { border-bottom: none; }
        .macro-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .macro-label { flex: 1; font-size: 15px; color: var(--curd); }
        .macro-val { font-family: 'IBM Plex Mono', monospace; font-size: 14.5px; }
        .macro-target { color: var(--muted); }
        .micro-row { padding: 10px 0; border-bottom: 1px solid var(--tin-light); }
        .micro-row:last-child { border-bottom: none; }
        .micro-label-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
        .micro-bar-track { height: 6px; background: var(--tin-light); border-radius: 3px; overflow: hidden; }
        .micro-bar-fill { height: 100%; border-radius: 3px; }
        .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
        .stat-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-family: 'IBM Plex Mono', monospace; }
        .stat-value { font-family: 'Fraunces', serif; font-size: 27px; font-weight: 600; margin-top: 6px; }
        .stat-unit { font-size: 14px; color: var(--muted); font-family: 'Work Sans', sans-serif; }
        .stat-sub { font-size: 13px; color: var(--muted); margin-top: 3px; }
        .dabba-textarea, .dabba-input, .dabba-select {
          width: 100%; background: var(--tin-light); border: 1px solid var(--steel); color: var(--curd);
          border-radius: 12px; padding: 13px 14px; font-size: 16px; font-family: 'Work Sans', sans-serif;
          margin-bottom: 12px; resize: vertical; min-height: 46px;
        }
        .field-label { font-size: 13px; color: var(--muted); margin-bottom: 6px; display: block; }
        .btn-primary, .btn-secondary {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 14px; border-radius: 12px; border: none; font-size: 15px; font-weight: 600;
          cursor: pointer; font-family: 'Work Sans', sans-serif; min-height: 48px;
        }
        .btn-primary { background: var(--turmeric); color: #1C1A17; }
        .btn-primary:disabled { opacity: 0.5; cursor: default; }
        .btn-secondary { background: transparent; color: var(--curd); border: 1px solid var(--steel); margin-top: 10px; }
        .icon-btn { background: none; border: none; color: var(--muted); cursor: pointer; padding: 9px; display: flex; }
        .icon-btn:disabled { opacity: 0.3; }
        .pill-tabs { display: flex; gap: 10px; margin-bottom: 18px; }
        .pill { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 12px; border-radius: 999px; border: 1px solid var(--steel); background: transparent; color: var(--muted); font-size: 14px; cursor: pointer; min-height: 46px; }
        .pill.active { background: var(--tin-light); color: var(--curd); border-color: var(--turmeric); }
        .error-text { display: flex; align-items: center; gap: 6px; color: var(--chili); font-size: 14px; margin-top: 10px; }
        .note-text { font-size: 13.5px; color: var(--muted); margin: 10px 0; line-height: 1.55; }
        .item-row { padding: 11px 0; border-bottom: 1px solid var(--tin-light); }
        .item-row-static { display: flex; justify-content: space-between; font-size: 14.5px; padding: 6px 0; }
        .item-name { font-size: 15px; }
        .item-qty { color: var(--muted); font-size: 13px; }
        .item-cal { font-family: 'IBM Plex Mono', monospace; color: var(--muted); font-size: 13px; }
        .item-macros { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
        .item-macros-header { display: flex; gap: 8px; font-size: 10.5px; color: var(--muted); margin: 6px 0; font-family: 'IBM Plex Mono', monospace; }
        .item-macros-header span { width: 48px; text-align: center; }
        .mini-input { width: 48px; background: var(--tin-light); border: 1px solid var(--steel); color: var(--curd); border-radius: 7px; padding: 6px 4px; font-size: 13px; text-align: center; }
        .ex-entry { font-size: 14.5px; padding: 4px 0; color: var(--curd); }
        .day-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
        .day-nav-label { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; }
        .meal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .empty-text { color: var(--muted); font-size: 14.5px; text-align: center; padding: 14px 0; }
        .ai-note { font-size: 15px; line-height: 1.65; color: var(--curd); font-family: 'Work Sans', sans-serif; }
        .custom-food-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; border-top: 1px solid var(--tin-light); margin-top: 10px; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .bottom-nav {
          position: fixed; bottom: var(--kb-offset, 0px); left: 50%; transform: translateX(-50%);
          width: 100%; max-width: 560px; background: var(--tin);
          border-top: 1px solid var(--steel); display: flex; padding: 10px 4px 16px;
          transition: bottom 0.15s ease-out;
        }
        .nav-btn {
          flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px;
          background: none; border: none; color: var(--muted); font-size: 11.5px;
          font-family: 'Work Sans', sans-serif; cursor: pointer; padding: 6px 2px; min-height: 52px;
        }
        .nav-btn.active { color: var(--turmeric); }
        .loading-shell { display: flex; align-items: center; justify-content: center; height: 100vh; color: var(--muted); gap: 8px; }
        .more-menu-item {
          display: flex; align-items: center; gap: 14px; width: 100%; text-align: left;
          background: var(--tin-light); border: 1px solid var(--steel); color: var(--curd);
          border-radius: 12px; padding: 15px 16px; font-size: 15px; font-family: 'Work Sans', sans-serif;
          cursor: pointer; margin-bottom: 10px; min-height: 52px;
        }
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.55);
          display: flex; align-items: flex-end; justify-content: center; z-index: 50;
        }
        .modal-card {
          background: var(--tin); border: 1px solid var(--steel); border-radius: 18px 18px 0 0;
          width: 100%; max-width: 560px; padding: 24px 20px 32px; box-sizing: border-box;
        }
        .chat-log { display: flex; flex-direction: column; gap: 10px; }
        .chat-bubble { max-width: 85%; padding: 11px 15px; border-radius: 16px; font-size: 14.5px; line-height: 1.55; }
        .chat-bubble.user { align-self: flex-end; background: var(--turmeric); color: #1C1A17; border-bottom-right-radius: 3px; }
        .chat-bubble.assistant { align-self: flex-start; background: var(--tin-light); color: var(--curd); border-bottom-left-radius: 3px; }
        .chat-input-row { display: flex; gap: 10px; align-items: center; position: sticky; bottom: calc(86px + var(--kb-offset, 0px)); }
        .send-btn { background: var(--turmeric); color: #1C1A17; border-radius: 12px; padding: 12px; min-height: 46px; min-width: 46px; }
        .send-btn:disabled { opacity: 0.4; }
      `}</style>

      {!ready ? (
        <div className="loading-shell"><Loader2 className="spin" size={18} /> Loading your dabba…</div>
      ) : (
        <>
          <div className="dabba-header">
            <div>
              <h1>Forge</h1>
              <div className="tag">your daily tiffin, tracked</div>
            </div>
          </div>
          <div className="tab-content">
            {tab === "dashboard" && <Dashboard profile={profile} meals={meals} weights={weights} exercise={exercise} sleep={sleep} budgetLog={budgetLog} />}
            {tab === "log" && <LogScreen customFoods={customFoods} onSaveMeal={handleSaveMeal} onSaveExercise={handleSaveExercise} onSaveSleep={handleSaveSleep} onAddCustomFood={handleAddCustomFood} />}
            {tab === "summary" && <DailySummary meals={meals} exercise={exercise} profile={profile} onDeleteMeal={handleDeleteMeal} />}
            {tab === "weight" && <WeightScreen weights={weights} onAddWeight={handleAddWeight} onImportWeights={handleImportWeights} />}
            {tab === "insights" && <ReportsScreen meals={meals} weights={weights} exercise={exercise} sleep={sleep} profile={profile} />}
            {tab === "chat" && (
              <ChatScreen
                nutritionHistory={chatHistory} exerciseHistory={exerciseChatHistory}
                onSendNutrition={handleChatUpdate} onSendExercise={handleExerciseChatUpdate}
                profile={profile} meals={meals} weights={weights} exercise={exercise} sleep={sleep}
              />
            )}
            {tab === "profile" && (
              <ProfileScreen
                profile={profile} onUpdateProfile={handleUpdateProfile}
                customFoods={customFoods} onAddCustomFood={handleAddCustomFood} onDeleteCustomFood={handleDeleteCustomFood}
                budgetLog={budgetLog}
              />
            )}
          </div>
          <div className="bottom-nav">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} className={tab === key ? "nav-btn active" : "nav-btn"} onClick={() => { setTab(key); setMoreOpen(false); }}>
                <Icon size={21} />
                {label}
              </button>
            ))}
            <button
              className={MORE_TABS.some((t) => t.key === tab) ? "nav-btn active" : "nav-btn"}
              onClick={() => setMoreOpen(true)}
            >
              <MoreHorizontal size={21} />
              More
            </button>
          </div>

          {moreOpen && (
            <div className="modal-overlay" onClick={() => setMoreOpen(false)}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="section-title" style={{ fontSize: 17, marginBottom: 12 }}>More</div>
                {MORE_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    className="more-menu-item"
                    onClick={() => { setTab(key); setMoreOpen(false); }}
                  >
                    <Icon size={20} />
                    <span>{label}</span>
                  </button>
                ))}
                <button className="btn-secondary" onClick={() => setMoreOpen(false)}>Close</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
