# Level run: Holiday rental flat (passed)

- Date: 2026-11-23T01:18:56.314Z
- Designer: gemini, model gemini-4-hydrogen, thinking the model's default
- Theme: a holiday rental flat
- Asked for: medium; measured difficulty 4 (hard)
- Rounds: 2 of at most 6

## Round 1 (23 s, 4099 tokens out)

```json
{
 "id": "holiday-rental",
 "name": "Holiday rental flat",
 "blurb": "A sunlit vacation rental with the bed along the east wall and cozy hideouts near the desk.",
 "pieces": [
  {
   "item": "bed",
   "wall": "east",
   "at": 1
  },
  {
   "item": "nightstand",
   "wall": "east",
   "at": -0.3
  },
  {
   "item": "desk",
   "wall": "north",
   "at": -1.5
  },
  {
   "item": "chair",
   "x": -1.5,
   "z": -1.4,
   "turn": 0
  },
  {
   "item": "wardrobe",
   "wall": "north",
   "at": 1.5
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": 2.7
  },
  {
   "item": "bookshelf",
   "wall": "west",
   "at": -1.5
  },
  {
   "item": "couch",
   "wall": "west",
   "at": 1.5
  },
  {
   "item": "coffeeTable",
   "x": -1.8,
   "z": 1.5,
   "turn": 0
  },
  {
   "item": "armchair",
   "x": 0.2,
   "z": 1.8,
   "turn": 2
  },
  {
   "item": "cardboardBox",
   "x": -2.5,
   "z": -0.2,
   "turn": 3
  }
 ],
 "cat": {
  "x": 0,
  "z": -0.5
 }
}
```

Rejected by the validator:

- `owner-cant-reach`: The owner cannot walk to where he checks the hiding place underDesk of desk (north wall, at -1.5) (x -1.77, z -1.60); in the way there: chair (x -1.5, z -1.4, turn 0) covers x -1.83..-1.17, z -1.73..-1.07. Leave about 1 m of open floor there and a way to it.

- warning `exposed`: The hiding place underArmchair can be seen from 16% of the room.

## Round 2 (25 s, 2592 tokens out)

```json
{
 "id": "holiday-rental",
 "name": "Holiday rental flat",
 "blurb": "A sunlit vacation rental with the bed along the east wall and cozy hideouts near the desk.",
 "pieces": [
  {
   "item": "bed",
   "wall": "east",
   "at": 1
  },
  {
   "item": "nightstand",
   "wall": "east",
   "at": -0.3
  },
  {
   "item": "desk",
   "wall": "north",
   "at": -1.5
  },
  {
   "item": "chair",
   "x": -1.05,
   "z": -1.72,
   "turn": 0
  },
  {
   "item": "wardrobe",
   "wall": "north",
   "at": 1.5
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": 2.7
  },
  {
   "item": "bookshelf",
   "wall": "west",
   "at": -1.5
  },
  {
   "item": "couch",
   "wall": "west",
   "at": 1.5
  },
  {
   "item": "coffeeTable",
   "x": -1.8,
   "z": 1.5,
   "turn": 0
  },
  {
   "item": "armchair",
   "x": 0.2,
   "z": 1.4,
   "turn": 3
  },
  {
   "item": "cardboardBox",
   "x": -2.5,
   "z": -0.2,
   "turn": 3
  }
 ],
 "cat": {
  "x": 0,
  "z": -0.5
 }
}
```

Passed the validator: {"freeFloor":20.9,"exposure":{"underBed":0,"underDesk":0.16,"underArmchair":0.17,"inBox":0},"hidingSpots":4,"crouchFinds":2,"meanCheckPath":4.69,"bedView":0.27,"props":70,"breakables":8,"safeSpots":2,"runToHide":4.65,"difficultyParts":{"view":0.68,"safe":0.67,"spots":0.6,"run":1,"walk":0.1},"difficultyScore":0.7,"difficulty":4}

- warning `exposed`: The hiding place underDesk can be seen from 16% of the room.
- warning `exposed`: The hiding place underArmchair can be seen from 17% of the room.
