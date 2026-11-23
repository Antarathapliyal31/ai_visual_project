// Each room's two missions (see src/core/missions.js for what they can be),
// written by a language model with `node scripts/generate-level.mjs --missions`
// and checked against what the room holds. A room missing here gets
// defaultMissions() in the game. This file is rewritten by the script.

export const MISSIONS = {
  "artist-studio": {
    "by": "Gemini (gemini-4-hydrogen) through Google's Gemini API",
    "missions": [
      {
        "type": "clear",
        "title": "Wreck the Worktable",
        "piece": "diningTable"
      },
      {
        "type": "hide",
        "title": "Monster Under Bed",
        "spot": "underBed"
      }
    ]
  },
  "cardboard-alley": {
    "by": "Gemini (gemini-3.6-flash) through Google's Gemini API",
    "missions": [
      {
        "type": "break",
        "title": "Desk Buffet Disaster",
        "kind": "plate",
        "count": 3,
        "piece": "desk"
      },
      {
        "type": "hide",
        "title": "Cardboard Box Phantom",
        "spot": "underArmchair"
      }
    ]
  },
  "cat-lovers-flat": {
    "by": "Gemini (gemini-4-hydrogen) through Google's Gemini API",
    "missions": [
      {
        "type": "clear",
        "title": "High Shelf Havoc",
        "piece": "wallShelf"
      },
      {
        "type": "hide",
        "title": "Armchair Peekaboo",
        "spot": "underArmchair"
      }
    ]
  },
  "kitchen-diner": {
    "by": "Gemini (gemini-3.6-flash) through Google's Gemini API",
    "missions": [
      {
        "type": "break",
        "title": "Desk Plate Smash",
        "kind": "plate",
        "count": 3,
        "piece": "desk"
      },
      {
        "type": "sneak",
        "title": "Whisker Close Call"
      }
    ]
  },
  "original": {
    "by": "Gemini (gemini-4-hydrogen) through Google's Gemini API",
    "missions": [
      {
        "type": "break",
        "title": "Late Night Dishes",
        "kind": "plate",
        "count": 3,
        "piece": "desk"
      },
      {
        "type": "hide",
        "title": "Monster Under Bed",
        "spot": "underBed"
      }
    ]
  },
  "plush-parlour": {
    "by": "Gemini (gemini-3.6-flash) through Google's Gemini API",
    "missions": [
      {
        "type": "break",
        "title": "Desk Dish Destruction",
        "kind": "plate",
        "count": 3,
        "piece": "desk"
      },
      {
        "type": "hide",
        "title": "Under Chair Cover",
        "spot": "underArmchair"
      }
    ]
  },
  "reading-den": {
    "by": "Gemini (gemini-3.6-flash) through Google's Gemini API",
    "missions": [
      {
        "type": "knock",
        "title": "Literary Avalanche",
        "kind": "book",
        "count": 6,
        "piece": "bookshelf"
      },
      {
        "type": "hide",
        "title": "Armchair Phantom",
        "spot": "underArmchair"
      }
    ]
  },
  "sparse-bedroom": {
    "by": "Gemini (gemini-3.6-flash) through Google's Gemini API",
    "missions": [
      {
        "type": "break",
        "title": "Late Night Smash",
        "kind": "plate",
        "count": 3,
        "piece": "desk"
      },
      {
        "type": "hide",
        "title": "Undercover Bed Bug",
        "spot": "underBed"
      }
    ]
  },
  "student-flat-mess": {
    "by": "Gemini (gemini-4-hydrogen) through Google's Gemini API",
    "missions": [
      {
        "type": "clear",
        "title": "Clear the Leftovers",
        "piece": "diningTable"
      },
      {
        "type": "hide",
        "title": "No Monsters Here",
        "spot": "underBed"
      }
    ]
  }
};
