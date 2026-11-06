export function createOwnerPlaceholder(options = {}) {
  const bedPosition = Array.isArray(options.bedPosition)
    ? [...options.bedPosition]
    : [0, 0, 0];

  const basePosition = Array.isArray(options.position)
    ? [...options.position]
    : [...bedPosition];

  const owner = {
    id: options.id ?? 'owner-placeholder',
    name: options.name ?? 'Owner',
    state: 'asleep',
    pose: 'lying',
    position: [...basePosition],
    bedPosition: [...bedPosition],
    target: options.target ?? null,
    wakeLevel: 0,
    isVisible: true,
    facing: options.facing ?? [0, 0, 1],

    setState(nextState) {
      this.state = nextState;
      if (nextState === 'asleep') this.pose = 'lying';
      else if (nextState === 'standing' || nextState === 'awake') this.pose = 'standing';
      else if (nextState === 'stirring' || nextState === 'sittingUp') this.pose = 'sitting';
      return this;
    },

    setPose(nextPose) {
      this.pose = nextPose;
      return this;
    },

    moveTo(position) {
      if (Array.isArray(position)) {
        this.position = [...position];
      }
      return this;
    },

    returnToBed() {
      this.position = [...this.bedPosition];
      this.state = 'asleep';
      this.pose = 'lying';
      this.target = null;
      return this;
    },

    syncFromAI(aiState) {
      if (!aiState || typeof aiState !== 'object') return this;

      if (aiState.state) this.state = aiState.state;
      if (typeof aiState.wakeLevel === 'number') this.wakeLevel = aiState.wakeLevel;
      if (Array.isArray(aiState.position)) this.position = [...aiState.position];
      if (Array.isArray(aiState.target)) this.target = [...aiState.target];

      if (this.state === 'asleep') this.pose = 'lying';
      else if (this.state === 'standing' || this.state === 'awake') this.pose = 'standing';
      else if (this.state === 'stirring' || this.state === 'sittingUp') this.pose = 'sitting';

      return this;
    },
  };

  owner.position = [...bedPosition];
  owner.pose = 'lying';
  owner.state = 'asleep';
  owner.target = null;
  return owner;
}
