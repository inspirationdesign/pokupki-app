import os
import asyncio
import uuid
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from pydantic import BaseModel

from database import engine, Base, get_db
from models import Family, User, Item

from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

# --- Environment ---
DATABASE_URL = os.getenv("DATABASE_URL")
BOT_TOKEN = os.getenv("BOT_TOKEN")

if not BOT_TOKEN:
    print("Warning: BOT_TOKEN not set. Bot features will not work.")

# --- App Setup ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Bot Setup ---
bot = Bot(token=BOT_TOKEN) if BOT_TOKEN else None
dp = Dispatcher()

# --- Pydantic Models ---
class ItemCreate(BaseModel):
    id: str
    text: str
    is_bought: bool
    category: str

class ItemUpdate(BaseModel):
    text: Optional[str] = None
    is_bought: Optional[bool] = None
    category: Optional[str] = None

class UserInfo(BaseModel):
    telegram_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    photo_url: Optional[str] = None

class FamilyMember(BaseModel):
    telegram_id: int
    username: Optional[str]

# --- Bot Handlers ---

async def ensure_user_and_family(session: AsyncSession, telegram_id: int, username: str = None):
    result = await session.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalars().first()

    if not user:
        # Create new family for new user
        invite_code = uuid.uuid4().hex[:8]
        new_family = Family(invite_code=invite_code)
        session.add(new_family)
        await session.flush() # get ID

        user = User(telegram_id=telegram_id, username=username, family_id=new_family.id)
        session.add(user)
        await session.commit()
    
    return user

@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    if not message.from_user:
        return

    args = message.text.split()
    invite_code = args[1] if len(args) > 1 else None
    
    telegram_id = message.from_user.id
    username = message.from_user.username

    async with AsyncSession(engine) as session:
        if invite_code and invite_code.startswith("invite_"):
            code = invite_code.replace("invite_", "")
            # Find family
            result = await session.execute(select(Family).where(Family.invite_code == code))
            family = result.scalars().first()
            
            if family:
                # Check if user exists
                result_user = await session.execute(select(User).where(User.telegram_id == telegram_id))
                user = result_user.scalars().first()
                
                if user:
                    if user.family_id != family.id:
                        user.family_id = family.id
                        await session.commit()
                        await message.answer("Вы успешно присоединились к семье!")
                    else:
                        await message.answer("Вы уже в этой семье.")
                else:
                    # Create user in this family
                    user = User(telegram_id=telegram_id, username=username, family_id=family.id)
                    session.add(user)
                    await session.commit()
                    await message.answer("Добро пожаловать! Вы присоединились к семье.")
            else:
                await message.answer("Неверный код приглашения.")
                # Fallback to normal init
                await ensure_user_and_family(session, telegram_id, username)
        else:
            await ensure_user_and_family(session, telegram_id, username)
            await message.answer("Добро пожаловать в Lumina Grocer!")

# --- API Endpoints ---

@app.on_event("startup")
async def on_startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    if bot:
        asyncio.create_task(dp.start_polling(bot))

@app.post("/auth")
async def auth_user(user_info: UserInfo, db: AsyncSession = Depends(get_db)):
    user = await ensure_user_and_family(db, user_info.telegram_id, user_info.username)
    
    # Get family info
    result_family = await db.execute(select(Family).where(Family.id == user.family_id))
    family = result_family.scalars().first()
    
    # Get members
    result_members = await db.execute(select(User).where(User.family_id == family.id))
    members = result_members.scalars().all()
    
    return {
        "user": user,
        "family": family,
        "members": members
    }

@app.get("/items")
async def get_items(telegram_id: int = Header(...), db: AsyncSession = Depends(get_db)):
    result_user = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result_user.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    result_items = await db.execute(select(Item).where(Item.family_id == user.family_id))
    items = result_items.scalars().all()
    return items

@app.post("/items")
async def create_item(item: ItemCreate, telegram_id: int = Header(...), db: AsyncSession = Depends(get_db)):
    result_user = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result_user.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    new_item = Item(
        id=item.id,
        text=item.text,
        is_bought=item.is_bought,
        category=item.category,
        family_id=user.family_id
    )
    db.add(new_item)
    await db.commit()
    return new_item

@app.put("/items/{item_id}")
async def update_item(item_id: str, updates: ItemUpdate, telegram_id: int = Header(...), db: AsyncSession = Depends(get_db)):
    result_user = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result_user.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result_item = await db.execute(select(Item).where(Item.id == item_id, Item.family_id == user.family_id))
    item = result_item.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    if updates.text is not None:
        item.text = updates.text
    if updates.is_bought is not None:
        item.is_bought = updates.is_bought
    if updates.category is not None:
        item.category = updates.category
        
    await db.commit()
    return item

@app.delete("/items/{item_id}")
async def delete_item(item_id: str, telegram_id: int = Header(...), db: AsyncSession = Depends(get_db)):
    result_user = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result_user.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    result_item = await db.execute(select(Item).where(Item.id == item_id, Item.family_id == user.family_id))
    item = result_item.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    await db.delete(item)
    await db.commit()
    return {"status": "deleted"}
