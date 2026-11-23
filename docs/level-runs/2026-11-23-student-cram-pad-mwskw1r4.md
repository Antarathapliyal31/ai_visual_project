# Level run: Student cram pad (passed)

- Date: 2026-11-23T01:19:45.376Z
- Designer: gemini, model gemini-4-hydrogen, thinking the model's default
- Theme: a student's study bedroom
- Asked for: medium; measured difficulty 3 (medium)
- Rounds: 2 of at most 6

## Round 1 (14 s, 3626 tokens out)

```json
{
 "id": "student-cram-pad",
 "name": "Student cram pad",
 "blurb": "A cluttered study bedroom with a desk full of mugs, stacked boxes, and a cozy armchair near the window.",
 "pieces": [
  {
   "item": "bed",
   "wall": "west",
   "at": 1
  },
  {
   "item": "nightstand",
   "wall": "west",
   "at": 2.45
  },
  {
   "item": "wardrobe",
   "wall": "west",
   "at": -1.2
  },
  {
   "item": "desk",
   "wall": "north",
   "at": -1.5
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": 0.8
  },
  {
   "item": "bookshelf",
   "wall": "north",
   "at": 2.4
  },
  {
   "item": "chair",
   "x": -1.5,
   "z": -1.5,
   "turn": 0
  },
  {
   "item": "armchair",
   "x": 1.6,
   "z": -1.2,
   "turn": 2
  },
  {
   "item": "cardboardBox",
   "x": -0.2,
   "z": 1.8,
   "turn": 1
  },
  {
   "item": "boxStack",
   "x": 1.8,
   "z": 1.2,
   "turn": 0
  }
 ],
 "cat": {
  "x": 0.2,
  "z": -0.2
 }
}
```

Rejected by the validator:

- `owner-cant-reach`: The owner cannot walk to where he checks the hiding place underDesk of desk (north wall, at -1.5) (x -1.77, z -1.60); in the way there: chair (x -1.5, z -1.5, turn 0) covers x -1.83..-1.17, z -1.83..-1.17. Leave about 1 m of open floor there and a way to it.

- warning `exposed`: The hiding place inBox can be seen from 34% of the room.

## Round 2 (15 s, 3529 tokens out)

```json
{
 "id": "student-cram-pad",
 "name": "Student cram pad",
 "blurb": "A cluttered study bedroom with a desk full of mugs, stacked boxes, and a cozy armchair near the window.",
 "pieces": [
  {
   "item": "bed",
   "wall": "west",
   "at": 1
  },
  {
   "item": "nightstand",
   "wall": "west",
   "at": 2.45
  },
  {
   "item": "wardrobe",
   "wall": "west",
   "at": -1.2
  },
  {
   "item": "desk",
   "wall": "north",
   "at": -1.5
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": 0.8
  },
  {
   "item": "bookshelf",
   "wall": "north",
   "at": 2.4
  },
  {
   "item": "chair",
   "x": -1.05,
   "z": -1.72,
   "turn": 0
  },
  {
   "item": "armchair",
   "x": 1.6,
   "z": -1.2,
   "turn": 2
  },
  {
   "item": "cardboardBox",
   "x": -0.2,
   "z": 1.5,
   "turn": 0
  },
  {
   "item": "boxStack",
   "x": 1.8,
   "z": 1.2,
   "turn": 0
  }
 ],
 "cat": {
  "x": 0.2,
  "z": -0.2
 }
}
```

Passed the validator: {"freeFloor":23.1,"exposure":{"underBed":0,"underDesk":0.14,"underArmchair":0.16,"inBox":0},"hidingSpots":4,"crouchFinds":2,"meanCheckPath":2.7,"bedView":0.21,"props":63,"breakables":7,"safeSpots":2,"runToHide":2.9,"difficultyParts":{"view":0.44,"safe":0.67,"spots":0.6,"run":0.63,"walk":0.77},"difficultyScore":0.61,"difficulty":3}

- warning `exposed`: The hiding place underArmchair can be seen from 16% of the room.
