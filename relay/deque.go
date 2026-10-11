package relay

import "sync"

// deque is a worker's local run queue. The owning worker pops from the
// front; its fill loop pushes to the back as it prefetches from the stream.
type deque struct {
	mu     sync.Mutex
	items  []Job
	head   int
	low    int
	hungry chan struct{}
}

func newDeque(low int) *deque {
	return &deque{low: low, hungry: make(chan struct{}, 1)}
}

func (d *deque) Push(j Job) {
	d.mu.Lock()
	d.items = append(d.items, j)
	d.mu.Unlock()
}

func (d *deque) Pop() (Job, bool) {
	d.mu.Lock()
	n := len(d.items) - d.head
	if n == 0 {
		d.mu.Unlock()
		d.signal()
		return Job{}, false
	}
	j := d.items[d.head]
	d.items[d.head] = Job{}
	d.head++
	if d.head == len(d.items) {
		d.items, d.head = d.items[:0], 0
	}
	n--
	d.mu.Unlock()
	if n <= d.low {
		d.signal()
	}
	return j, true
}

func (d *deque) Len() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.items) - d.head
}

// Drop empties the deque. Dropped jobs stay pending in the stream and are
// reclaimed by peers once they have been idle for long enough.
func (d *deque) Drop() {
	d.mu.Lock()
	d.items, d.head = nil, 0
	d.mu.Unlock()
}

func (d *deque) signal() {
	select {
	case d.hungry <- struct{}{}:
	default:
	}
}
