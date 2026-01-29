from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, BigInteger
from sqlalchemy.orm import relationship
from database import Base

class Family(Base):
    __tablename__ = "families"

    id = Column(Integer, primary_key=True, index=True)
    invite_code = Column(String, unique=True, index=True)

    users = relationship("User", back_populates="family")
    items = relationship("Item", back_populates="family")

class User(Base):
    __tablename__ = "users"

    telegram_id = Column(BigInteger, primary_key=True, index=True)
    username = Column(String, nullable=True)
    family_id = Column(Integer, ForeignKey("families.id"))

    family = relationship("Family", back_populates="users")

class Item(Base):
    __tablename__ = "items"

    id = Column(String, primary_key=True, index=True)
    text = Column(String)
    is_bought = Column(Boolean, default=False)
    category = Column(String)
    family_id = Column(Integer, ForeignKey("families.id"))

    family = relationship("Family", back_populates="items")
