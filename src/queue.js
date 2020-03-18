class Queue {
  constructor() {
    this.stupidArray = [];
    this.length = 0;
  }
  push(val) {
    this.stupidArray.push(val);
    this.length = this.stupidArray.length;
  }
  shift() {
    const ret = this.stupidArray.shift();
    this.length = this.stupidArray.length;
    return ret;
  }
}

module.exports = Queue;
