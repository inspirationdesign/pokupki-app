import { GoogleGenAI, Type } from "@google/genai";
import { CategoryDef, SmartCategoryResponse, PurchaseLog } from "../types";

const MODEL_NAME = 'gemini-3-flash-preview';

// Robust way to get the API key in different environments (Vite vs Node/Standard)
const getApiKey = (): string => {
  // 1. Try standard process.env (Node/Webpack)
  if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
    return process.env.API_KEY;
  }
  // 2. Try Vite specific import.meta.env
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY) {
    // @ts-ignore
    return import.meta.env.VITE_GEMINI_API_KEY;
  }
  return '';
};

const API_KEY = getApiKey();

async function callWithRetry<T>(fn: () => Promise<T>, retries = 5, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    console.error("[Lumina Service] AI Error Details:", error);
    
    const isRateLimit = 
      error?.status === 429 || 
      error?.code === 429 ||
      error?.message?.includes('429') || 
      error?.message?.includes('quota') ||
      error?.message?.includes('RESOURCE_EXHAUSTED') ||
      (error?.error && (error.error.code === 429 || error.error.status === 'RESOURCE_EXHAUSTED'));

    if (retries > 0 && isRateLimit) {
      console.log(`[Lumina Service] Rate limit hit. Retrying in ${delay}ms... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callWithRetry(fn, retries - 1, delay * 1.5);
    }
    throw error;
  }
}

// Categorize a single product name into an existing or new category
export const categorizeProduct = async (productName: string, availableCategories: CategoryDef[]): Promise<SmartCategoryResponse | null> => {
  if (!API_KEY) {
    console.error("Gemini API Key is missing. Check your .env file.");
    throw new Error("API ключ не найден.");
  }

  const categoryNames = availableCategories.map(c => c.name);

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Category for: "${productName}". 
      Existing: ${categoryNames.join(', ')}. 
      If none fit, make new.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categoryName: { type: Type.STRING },
            suggestedEmoji: { type: Type.STRING },
            isNew: { type: Type.BOOLEAN }
          },
          required: ["categoryName", "suggestedEmoji", "isNew"]
        }
      }
    });

    return response.text ? JSON.parse(response.text.trim()) : null;
  });
};

// Generate a set of shopping items (e.g. ingredients for a dish)
export const generateSetItems = async (setName: string, availableCategories: CategoryDef[]) => {
  if (!API_KEY) {
    console.error("Gemini API Key is missing. Check your .env file.");
    throw new Error("API ключ не найден.");
  }
  const categoryNames = availableCategories.map(c => c.name);

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Create shopping list for: "${setName}".
      
      CRITICAL RULES:
      1. Capitalize first letter (e.g. "Milk", not "milk").
      2. Keep user's intent:
         - If user asks for "Pizza" (dish) -> return 1 item "Pizza".
         - If user asks for "Pizza kit", "Ingredients for pizza", "All for pizza" -> return ingredients (Dough, Sauce, Cheese...).
      3. Use categories from: ${categoryNames.join(', ')}.`,
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            setEmoji: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  categoryName: { type: Type.STRING },
                  emoji: { type: Type.STRING }
                },
                required: ["name", "categoryName", "emoji"]
              }
            }
          },
          required: ["setEmoji", "items"]
        }
      }
    });
    return response.text ? JSON.parse(response.text.trim()) : { setEmoji: '🍱', items: [] };
  });
};

// Parse a dictated string into a list of specific products
export const parseDictatedText = async (text: string, availableCategories: CategoryDef[]) => {
  if (!API_KEY) {
    console.error("Gemini API Key is missing. Check your .env file.");
    throw new Error("API ключ не найден.");
  }
  const categoryNames = availableCategories.map(c => c.name);

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Parse shopping items from text: "${text}".
      
      STRICT RULES:
      1. Capitalize first letter of every item (e.g. "Oranges", "Bread").
      2. PRESERVE GRAMMATICAL NUMBER:
         - "Apples" -> "Apples"
         - "Apple" -> "Apple"
         - "10 eggs" -> "Eggs" (quantity handled separately usually, but here just name)
      3. CONTEXT AWARENESS:
         - "Pizza" -> Single item "Pizza" (DishName: null).
         - "Ingredients for pizza", "Pizza kit", "Everything for soup" -> List ingredients (DishName: "Pizza").
      
      Categories: ${categoryNames.join(', ')}.`,
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  categoryName: { type: Type.STRING },
                  suggestedEmoji: { type: Type.STRING }
                },
                required: ["name", "categoryName", "suggestedEmoji"]
              }
            },
            dishName: { type: Type.STRING }
          },
          required: ["items", "dishName"]
        }
      }
    });
    return response.text ? JSON.parse(response.text.trim()) : { items: [], dishName: null };
  });
};

// Analyze purchase history to suggest sets
export const analyzeHistoryForSets = async (logs: PurchaseLog[], availableCategories: CategoryDef[]) => {
  if (!API_KEY) {
    console.error("Gemini API Key is missing. Check your .env file.");
    throw new Error("API ключ не найден.");
  }
  const categoryNames = availableCategories.map(c => c.name);
  
  const historySummary = logs.map(l => ({
    date: new Date(l.date).toDateString(),
    items: l.items.map(i => i.name)
  }));

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Analyze history and suggest 3 logical shopping sets.
      History: ${JSON.stringify(historySummary)}.
      Categories: ${categoryNames.join(', ')}.
      Rule: Capitalize all item names.`,
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              emoji: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    categoryName: { type: Type.STRING },
                    emoji: { type: Type.STRING }
                  },
                  required: ["name", "categoryName", "emoji"]
                }
              }
            },
            required: ["name", "emoji", "items"]
          }
        }
      }
    });
    return response.text ? JSON.parse(response.text.trim()) : [];
  });
};