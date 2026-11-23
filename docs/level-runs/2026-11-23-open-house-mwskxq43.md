# Level run: Open house (passed)

- Date: 2026-11-23T01:21:03.603Z
- Designer: gemini, model gemini-4-hydrogen, thinking the model's default
- Theme: a show flat staged for sale, very tidy
- Asked for: hard; measured difficulty 4 (hard)
- Rounds: 1 of at most 6

## Round 1 (90 s, 10645 tokens out)

```json
{
 "id": "open-house",
 "name": "Open house",
 "blurb": "A spotless flat staged for buyers: the bed faces an empty middle floor from the south wall, leaving a long exposed dash from the far desk and dining table.",
 "pieces": [
  {
   "item": "bed",
   "wall": "south",
   "at": -2.1
  },
  {
   "item": "nightstand",
   "wall": "south",
   "at": -3.22
  },
  {
   "item": "wallShelf",
   "wall": "west",
   "at": 1.7
  },
  {
   "item": "aquarium",
   "wall": "west",
   "at": 0.1
  },
  {
   "item": "bookshelf",
   "wall": "west",
   "at": -1.15
  },
  {
   "item": "wardrobe",
   "wall": "west",
   "at": -2.3
  },
  {
   "item": "windowSill",
   "wall": "north",
   "at": -2.1
  },
  {
   "item": "couch",
   "wall": "north",
   "at": -0.6
  },
  {
   "item": "desk",
   "wall": "north",
   "at": 2
  },
  {
   "item": "chair",
   "x": 2.45,
   "z": -1.72,
   "turn": 0
  },
  {
   "item": "diningTable",
   "x": 2.1,
   "z": 1.2,
   "turn": 0
  }
 ],
 "cat": {
  "x": 0.1,
  "z": -0.2
 }
}
```

Passed the validator: {"freeFloor":24.1,"exposure":{"underBed":0,"underDesk":0.19,"underTable":0.04},"hidingSpots":3,"crouchFinds":2,"meanCheckPath":3.21,"bedView":0.23,"props":75,"breakables":12,"safeSpots":1,"runToHide":5.28,"difficultyParts":{"view":0.52,"safe":1,"spots":0.8,"run":1,"walk":0.6},"difficultyScore":0.83,"difficulty":4}

- warning `exposed`: The hiding place underDesk can be seen from 19% of the room.
