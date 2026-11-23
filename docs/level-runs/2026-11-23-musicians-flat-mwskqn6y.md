# Level run: Musician's flat (passed)

- Date: 2026-11-23T01:15:33.226Z
- Designer: gemini, model gemini-3.6-flash, thinking the model's default
- Theme: a musician's flat
- Asked for: medium; measured difficulty 4 (hard)
- Rounds: 1 of at most 6

## Round 1 (203 s, 4988 tokens out)

```json
{
 "id": "musicians-flat",
 "name": "Musician's flat",
 "blurb": "Instruments, stacked boxes, and music gear surround a bed on the east wall, leaving long runs to hidden spots.",
 "pieces": [
  {
   "item": "bed",
   "wall": "east",
   "at": 0.5
  },
  {
   "item": "nightstand",
   "wall": "east",
   "at": -0.8
  },
  {
   "item": "desk",
   "wall": "north",
   "at": -1.8
  },
  {
   "item": "bookshelf",
   "wall": "north",
   "at": 0.8
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": 2.4
  },
  {
   "item": "couch",
   "wall": "west",
   "at": 1.2
  },
  {
   "item": "coffeeTable",
   "x": -1.6,
   "z": 1.2,
   "turn": 0
  },
  {
   "item": "chair",
   "x": -0.9,
   "z": -1.5,
   "turn": 0
  },
  {
   "item": "armchair",
   "x": 0.5,
   "z": 2,
   "turn": 3
  },
  {
   "item": "cardboardBox",
   "x": -2.8,
   "z": 0,
   "turn": 2
  },
  {
   "item": "boxStack",
   "x": -2.8,
   "z": -1.4,
   "turn": 0
  }
 ],
 "cat": {
  "x": 0,
  "z": -0.5
 }
}
```

Passed the validator: {"freeFloor":21.3,"exposure":{"underBed":0,"underDesk":0.17,"underArmchair":0.06,"inBox":0.04},"hidingSpots":4,"crouchFinds":2,"meanCheckPath":4.22,"bedView":0.3,"props":70,"breakables":8,"safeSpots":2,"runToHide":5.2,"difficultyParts":{"view":0.8,"safe":0.67,"spots":0.6,"run":1,"walk":0.26},"difficultyScore":0.74,"difficulty":4}

- warning `exposed`: The hiding place underDesk can be seen from 17% of the room.
