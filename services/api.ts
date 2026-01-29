import { ProductItem } from '../types';

const API_BASE = 'http://localhost:8000'; // Change this in production

export interface User {
  telegram_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  family_id?: number;
}

export interface Family {
  id: number;
  invite_code: string;
}

export const api = {
  async auth(user: User) {
    const res = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
    if (!res.ok) throw new Error('Auth failed');
    return res.json();
  },

  async getItems(telegramId: number): Promise<ProductItem[]> {
    const res = await fetch(`${API_BASE}/items`, {
      headers: { 'telegram-id': telegramId.toString() }
    });
    if (!res.ok) throw new Error('Failed to fetch items');
    return res.json();
  },

  async addItem(item: ProductItem, telegramId: number) {
    const res = await fetch(`${API_BASE}/items`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'telegram-id': telegramId.toString()
      },
      body: JSON.stringify({
        id: item.id,
        text: item.name,
        is_bought: item.completed,
        category: item.categoryId
      })
    });
    if (!res.ok) throw new Error('Failed to add item');
    return res.json();
  },

  async updateItem(item: ProductItem, telegramId: number) {
    const res = await fetch(`${API_BASE}/items/${item.id}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'telegram-id': telegramId.toString()
      },
      body: JSON.stringify({
        text: item.name,
        is_bought: item.completed,
        category: item.categoryId
      })
    });
    if (!res.ok) throw new Error('Failed to update item');
    return res.json();
  },

  async deleteItem(itemId: string, telegramId: number) {
    const res = await fetch(`${API_BASE}/items/${itemId}`, {
      method: 'DELETE',
      headers: { 'telegram-id': telegramId.toString() }
    });
    if (!res.ok) throw new Error('Failed to delete item');
    return res.json();
  }
};
