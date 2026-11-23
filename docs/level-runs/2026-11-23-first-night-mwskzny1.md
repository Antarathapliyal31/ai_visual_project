# Level run: First night (passed)

- Date: 2026-11-23T01:22:34.105Z
- Designer: gemini, model gemini-4-hydrogen, thinking the model's default
- Theme: a bare room on moving-in day
- Asked for: hard; measured difficulty 4 (hard)
- Rounds: 1 of at most 6

## Round 1 (39 s, 10110 tokens out)

```json
{
 "id": "first-night",
 "name": "First night",
 "blurb": "Bare floorboards on moving-in day: only the bed, a far desk and dining table, and wide open floor between them.",
 "pieces": [
  {
   "item": "bed",
   "wall": "east",
   "at": 1.5
  },
  {
   "item": "desk",
   "wall": "north",
   "at": -2
  },
  {
   "item": "diningTable",
   "x": -2.2,
   "z": 1.1,
   "turn": 0
  },
  {
   "item": "boxStack",
   "x": 3,
   "z": -2.5,
   "turn": 0
  },
  {
   "item": "boxStack",
   "x": 3,
   "z": -1,
   "turn": 1
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": 0.4
  },
  {
   "item": "wallShelf",
   "wall": "west",
   "at": -0.6
  }
 ],
 "cat": {
  "x": -0.2,
  "z": -1
 }
}
```

Passed the validator: {"freeFloor":26.3,"exposure":{"underBed":0,"underDesk":0.19,"underTable":0.02},"hidingSpots":3,"crouchFinds":2,"meanCheckPath":4.1,"bedView":0.18,"props":28,"breakables":12,"safeSpots":1,"runToHide":5.54,"difficultyParts":{"view":0.32,"safe":1,"spots":0.8,"run":1,"walk":0.3},"difficultyScore":0.76,"difficulty":4}

- warning `exposed`: The hiding place underDesk can be seen from 19% of the room.
