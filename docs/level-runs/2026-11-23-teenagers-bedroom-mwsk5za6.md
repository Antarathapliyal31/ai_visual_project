# Level run: Teenager's lair (passed)

- Date: 2026-11-23T00:59:29.118Z
- Designer: gemini, model gemini-3.6-flash, thinking the model's default
- Theme: a messy teenager's bedroom
- Asked for: easy; measured difficulty 2 (easy)
- Rounds: 1 of at most 6

## Round 1 (262 s, 5488 tokens out)

```json
{
 "id": "teenagers-bedroom",
 "name": "Teenager's lair",
 "blurb": "Clothes and boxes clutter the room around a desk, offering safe hiding spots far from the bed.",
 "pieces": [
  {
   "item": "bed",
   "wall": "west",
   "at": 1.8
  },
  {
   "item": "nightstand",
   "wall": "west",
   "at": 0.2
  },
  {
   "item": "wardrobe",
   "wall": "west",
   "at": -1.8
  },
  {
   "item": "bookshelf",
   "wall": "north",
   "at": -1.2
  },
  {
   "item": "wallShelf",
   "wall": "north",
   "at": -2.7
  },
  {
   "item": "desk",
   "wall": "north",
   "at": 1.4
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": 2.9
  },
  {
   "item": "chair",
   "x": 1.4,
   "z": -1.4,
   "turn": 0
  },
  {
   "item": "armchair",
   "x": -0.2,
   "z": -1.2,
   "turn": 0
  },
  {
   "item": "armchair",
   "x": 2,
   "z": -0.2,
   "turn": 3
  },
  {
   "item": "cardboardBox",
   "x": 2.9,
   "z": -1.2,
   "turn": 2
  },
  {
   "item": "boxStack",
   "x": -0.5,
   "z": 0.8,
   "turn": 0
  },
  {
   "item": "catTree",
   "x": 2.8,
   "z": 1.8,
   "turn": 0
  }
 ],
 "cat": {
  "x": 0.5,
  "z": 1
 }
}
```

Passed the validator: {"freeFloor":20.7,"exposure":{"underBed":0,"underDesk":0.13,"underArmchair":0.16,"underArmchair#2":0.13,"inBox":0},"hidingSpots":5,"crouchFinds":2,"meanCheckPath":4.41,"bedView":0.19,"props":71,"breakables":7,"safeSpots":3,"runToHide":1.84,"difficultyParts":{"view":0.36,"safe":0.33,"spots":0.4,"run":0.28,"walk":0.2},"difficultyScore":0.32,"difficulty":2}

- warning `exposed`: The hiding place underArmchair can be seen from 16% of the room.
