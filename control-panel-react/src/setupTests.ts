import '@testing-library/jest-dom';

const createMockAudioContext = () => ({
  createOscillator: jest.fn(),
  createGain: jest.fn(),
  destination: {},
  currentTime: 0,
  resume: jest.fn(),
  close: jest.fn()
});

if (typeof window !== 'undefined') {
  if (!(window as any).AudioContext) {
    (window as any).AudioContext = jest.fn().mockImplementation(createMockAudioContext);
  }

  if (!(window as any).webkitAudioContext) {
    (window as any).webkitAudioContext = (window as any).AudioContext;
  }
}
