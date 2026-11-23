# Level run: Cardboard Alley (passed)

- Date: 2026-11-23T00:43:52.358Z
- Designer: gemini, model gemini-4-hydrogen, thinking the model's default
- Theme: a cluttered storage room with open boxes by the desk
- Asked for: easy; measured difficulty 2 (easy)
- Rounds: 1 of at most 6

## Round 1 (302 s, 26920 tokens out)

```json
{
 "id": "cardboard-alley",
 "name": "Cardboard Alley",
 "blurb": "A south-west bed sits walled off by stacked boxes and a wardrobe, leaving safe box and armchair hideouts packed tightly around the far desk.",
 "pieces": [
  {
   "item": "bed",
   "wall": "south",
   "at": -2.1
  },
  {
   "item": "nightstand",
   "wall": "south",
   "at": -3.2
  },
  {
   "item": "wallShelf",
   "wall": "west",
   "at": 1.4
  },
  {
   "item": "wardrobe",
   "wall": "west",
   "at": -0.3
  },
  {
   "item": "bookshelf",
   "wall": "west",
   "at": -1.4
  },
  {
   "item": "windowSill",
   "wall": "west",
   "at": -2.4
  },
  {
   "item": "desk",
   "wall": "north",
   "at": 1.5
  },
  {
   "item": "chair",
   "x": 1.95,
   "z": -1.72,
   "turn": 0
  },
  {
   "item": "couch",
   "wall": "east",
   "at": 1.3
  },
  {
   "item": "armchair",
   "x": 0.45,
   "z": -0.35,
   "turn": 1
  },
  {
   "item": "armchair",
   "x": 0.85,
   "z": 1.3,
   "turn": 0
  },
  {
   "item": "cardboardBox",
   "x": -0.65,
   "z": -1.65,
   "turn": 2
  },
  {
   "item": "cardboardBox",
   "x": 2.15,
   "z": -0.5,
   "turn": 1
  },
  {
   "item": "cardboardBox",
   "x": -2.1,
   "z": -1.65,
   "turn": 2
  },
  {
   "item": "boxStack",
   "x": -2.05,
   "z": 0,
   "turn": 0
  },
  {
   "item": "catTree",
   "x": -0.95,
   "z": 0,
   "turn": 0
  },
  {
   "item": "boxStack",
   "x": 0.2,
   "z": 2.65,
   "turn": 0
  }
 ],
 "cat": {
  "x": 1.5,
  "z": 2.3
 }
}
```

Passed the validator: {"freeFloor":16.4,"exposure":{"underBed":0,"underDesk":0.21,"underArmchair":0.16,"underArmchair#2":0.07,"inBox":0,"inBox#2":0,"inBox#3":0},"hidingSpots":7,"crouchFinds":4,"meanCheckPath":4.16,"bedView":0.14,"props":70,"breakables":7,"safeSpots":3,"runToHide":2.3,"difficultyParts":{"view":0.16,"safe":0.33,"spots":0,"run":0.43,"walk":0.28},"difficultyScore":0.27,"difficulty":2}

- warning `exposed`: The hiding place underDesk can be seen from 21% of the room.
- warning `exposed`: The hiding place underArmchair can be seen from 16% of the room.
