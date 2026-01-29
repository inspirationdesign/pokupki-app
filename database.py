import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from urllib.parse import urlparse, urlunparse

Base = declarative_base()

def get_database_url():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL is not set")
    
    # Parse and fix scheme for asyncpg
    parsed = urlparse(url)
    if parsed.scheme.startswith("postgres") and "asyncpg" not in parsed.scheme:
        # Replace scheme with postgresql+asyncpg
        new_scheme = "postgresql+asyncpg"
        # Handle port 5433 or others explicitly if needed, but urlparse handles :port correctly
        url = urlunparse(parsed._replace(scheme=new_scheme))
    
    return url

DATABASE_URL = get_database_url()

engine = create_async_engine(DATABASE_URL, echo=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
