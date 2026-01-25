import { GoogleGenAI, Type } from "@google/genai";
import { CategoryDef, SmartCategoryResponse, PurchaseLog } from "../types";

const MODEL_NAME = 'gemini-3-flash-preview';

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
  const categoryNames = availableCategories.map(c => c.name);

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Определи категорию для: "${productName}". 
      Существующие: ${categoryNames.join(', ')}. 
      Если не подходит, создай новую.`,
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
  const categoryNames = availableCategories.map(c => c.name);

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Составь список ингредиентов для: "${setName}". Категории из: ${categoryNames.join(', ')}.`,
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
  const categoryNames = availableCategories.map(c => c.name);

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Извлеки товары из: "${text}". ПРАВИЛО: Блюдо (шаурма, пицца) = 1 товар, если не сказано "ингредиенты для" или "набор для". Если сказано "набор" или "ингредиенты", разбей на составные части. Категории из: ${categoryNames.join(', ')}.`,
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
  const categoryNames = availableCategories.map(c => c.name);
  
  const historySummary = logs.map(l => ({
    date: new Date(l.date).toDateString(),
    items: l.items.map(i => i.name)
  }));

  return callWithRetry(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Проанализируй историю покупок и предложи 3 логичных набора товаров, которые часто покупаются вместе или регулярно.
      История: ${JSON.stringify(historySummary)}.
      Используй категории: ${categoryNames.join(', ')}.
      Для каждого набора придумай название, эмодзи и список товаров.`,
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