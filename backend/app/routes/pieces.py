
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/pieces", tags=["pieces"])

@router.get("/", response_model=List[schemas.PieceResponse])
def get_pieces(db: Session = Depends(get_db)):
    return db.query(models.Piece).all()

@router.post("/", response_model=schemas.PieceResponse)
def create_piece(piece: schemas.PieceCreate, db: Session = Depends(get_db)):
    db_piece = models.Piece(**piece.dict())
    db.add(db_piece)
    db.commit()
    db.refresh(db_piece)
    return db_piece

@router.post("/batch")
def create_pieces_batch(pieces: List[schemas.PieceCreate], db: Session = Depends(get_db)):
    db_pieces = [models.Piece(**p.dict()) for p in pieces]
    db.add_all(db_pieces)
    db.commit()
    return {"message": f"Created {len(db_pieces)} pieces"}

@router.delete("/{piece_id}")
def delete_piece(piece_id: int, db: Session = Depends(get_db)):
    piece = db.query(models.Piece).filter(models.Piece.id == piece_id).first()
    if not piece:
        raise HTTPException(status_code=404, detail="Piece not found")
    db.delete(piece)
    db.commit()
    return {"message": "Piece deleted"}

@router.delete("/")
def delete_all_pieces(db: Session = Depends(get_db)):
    db.query(models.Piece).delete()
    db.commit()
    return {"message": "All pieces deleted"}
