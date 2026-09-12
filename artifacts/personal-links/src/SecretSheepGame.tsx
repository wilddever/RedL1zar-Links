import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_Y = 420;
const SHEEP_X = 142;
const SHEEP_WIDTH = 68;
const SHEEP_STANDING_HEIGHT = 58;
const SHEEP_DUCKING_HEIGHT = 34;

type GamePhase = 'ready' | 'playing' | 'gameover';
type ObstacleKind = 'sign' | 'horse';

type Obstacle = {
  kind: ObstacleKind;
  x: number;
  width: number;
  top: number;
  height: number;
};

type Sheep = {
  bottom: number;
  velocityY: number;
  ducking: boolean;
};

type Runtime = {
  sheep: Sheep;
  obstacles: Obstacle[];
  score: number;
  speed: number;
  obstacleTimer: number;
  horseTimer: number;
  groundOffset: number;
  distance: number;
};

const COLORS = {
  ink: '#080808',
  white: '#f2f0df',
  cream: '#d5d0bc',
  shadow: '#817e72',
  red: '#ed554f',
  green: '#b9df57',
  grey: '#66645f',
  forestFar: '#1b3036',
  forestMid: '#14272d',
  forestNear: '#0d1c21',
  horse: '#c98b68',
  horseLight: '#e1ac7f',
  horseDark: '#6f473f',
};

function createRuntime(): Runtime {
  return {
    sheep: {
      bottom: GROUND_Y,
      velocityY: 0,
      ducking: false,
    },
    obstacles: [],
    score: 0,
    speed: 330,
    obstacleTimer: 1.1,
    horseTimer: 2.6,
    groundOffset: 0,
    distance: 0,
  };
}

function fillPixel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), width, height);
}

function drawPixelSheep(
  context: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  ducking: boolean,
  time: number,
) {
  const y = bottom - (ducking ? SHEEP_DUCKING_HEIGHT : SHEEP_STANDING_HEIGHT);

  if (ducking) {
    fillPixel(context, x + 5, y + 10, 43, 19, COLORS.white);
    fillPixel(context, x + 11, y + 5, 12, 7, COLORS.white);
    fillPixel(context, x + 27, y + 4, 13, 8, COLORS.white);
    fillPixel(context, x + 1, y + 13, 8, 8, COLORS.shadow);
    fillPixel(context, x + 42, y + 12, 17, 16, COLORS.ink);
    fillPixel(context, x + 54, y + 17, 9, 10, COLORS.ink);
    fillPixel(context, x + 40, y + 7, 9, 5, COLORS.ink);
    fillPixel(context, x + 47, y + 3, 8, 5, COLORS.ink);
    fillPixel(context, x + 53, y + 16, 4, 4, COLORS.white);
    fillPixel(context, x + 62, y + 22, 5, 4, COLORS.ink);
    fillPixel(context, x + 3, y + 27, 16, 5, COLORS.shadow);
    fillPixel(context, x + 28, y + 27, 13, 5, COLORS.shadow);
    return;
  }

  const airborne = bottom < GROUND_Y - 1;
  const step = Math.round(Math.sin(time * 0.018) * 3);
  const oppositeStep = -step;

  // Large wool body, dark face, ear, eye and four small legs.
  fillPixel(context, x + 1, y + 25, 8, 9, COLORS.shadow);
  fillPixel(context, x + 2, y + 20, 6, 7, COLORS.white);
  fillPixel(context, x + 8, y + 15, 9, 7, COLORS.white);
  fillPixel(context, x + 6, y + 19, 43, 24, COLORS.white);
  fillPixel(context, x + 11, y + 13, 12, 9, COLORS.white);
  fillPixel(context, x + 25, y + 9, 13, 10, COLORS.white);
  fillPixel(context, x + 39, y + 14, 12, 10, COLORS.white);
  fillPixel(context, x + 17, y + 18, 8, 7, COLORS.white);
  fillPixel(context, x + 47, y + 23, 16, 21, COLORS.ink);
  fillPixel(context, x + 57, y + 29, 10, 13, COLORS.ink);
  fillPixel(context, x + 52, y + 20, 8, 5, COLORS.ink);
  fillPixel(context, x + 45, y + 16, 9, 7, COLORS.ink);
  fillPixel(context, x + 48, y + 11, 8, 6, COLORS.shadow);
  fillPixel(context, x + 55, y + 25, 4, 4, COLORS.white);
  fillPixel(context, x + 62, y + 37, 5, 4, COLORS.ink);

  if (airborne) {
    // Tuck the legs under the wool while the sheep is in the air.
    fillPixel(context, x + 10, y + 45, 17, 7, COLORS.shadow);
    fillPixel(context, x + 34, y + 45, 17, 7, COLORS.shadow);
    fillPixel(context, x + 7, y + 50, 12, 4, COLORS.ink);
    fillPixel(context, x + 37, y + 50, 12, 4, COLORS.ink);
  } else {
    // Alternating legs make the running cycle readable even at pixel scale.
    fillPixel(context, x + 9, y + 42, 7, 13 + step, COLORS.shadow);
    fillPixel(context, x + 24, y + 42, 7, 13 + oppositeStep, COLORS.shadow);
    fillPixel(context, x + 39, y + 42, 7, 13 + oppositeStep, COLORS.shadow);
    fillPixel(context, x + 51, y + 42, 7, 13 + step, COLORS.shadow);
    fillPixel(context, x + 8, y + 55 + step, 9, 3, COLORS.ink);
    fillPixel(context, x + 23, y + 55 + oppositeStep, 9, 3, COLORS.ink);
    fillPixel(context, x + 38, y + 55 + oppositeStep, 9, 3, COLORS.ink);
    fillPixel(context, x + 50, y + 55 + step, 9, 3, COLORS.ink);
  }
}

function drawPixelSign(context: CanvasRenderingContext2D, x: number, bottom: number) {
  const top = bottom - 74;
  const poleX = x + 30;
  fillPixel(context, poleX, bottom - 6, 6, 42, COLORS.grey);
  fillPixel(context, poleX - 5, bottom + 32, 16, 4, COLORS.grey);

  context.fillStyle = COLORS.red;
  context.beginPath();
  context.moveTo(x + 33, top);
  context.lineTo(x + 1, bottom - 15);
  context.lineTo(x + 65, bottom - 15);
  context.closePath();
  context.fill();

  context.fillStyle = COLORS.white;
  context.beginPath();
  context.moveTo(x + 33, top + 8);
  context.lineTo(x + 11, bottom - 21);
  context.lineTo(x + 55, bottom - 21);
  context.closePath();
  context.fill();

  // Clip the pictogram to the white triangle so no pixel can cross the red frame.
  context.save();
  context.beginPath();
  context.moveTo(x + 33, top + 8);
  context.lineTo(x + 11, bottom - 21);
  context.lineTo(x + 55, bottom - 21);
  context.closePath();
  context.clip();

  // Small, simple seated worker matching the sign on the main page.
  fillPixel(context, x + 30, top + 26, 4, 4, COLORS.ink);
  fillPixel(context, x + 29, top + 30, 5, 9, COLORS.ink);
  fillPixel(context, x + 26, top + 33, 3, 12, COLORS.ink);
  fillPixel(context, x + 27, top + 40, 10, 3, COLORS.ink);
  fillPixel(context, x + 34, top + 42, 3, 8, COLORS.ink);
  fillPixel(context, x + 35, top + 32, 6, 5, COLORS.ink);
  fillPixel(context, x + 37, top + 37, 2, 5, COLORS.ink);
  fillPixel(context, x + 33, top + 41, 10, 3, COLORS.ink);
  context.restore();
}

function drawPixelHorse(context: CanvasRenderingContext2D, x: number, top: number) {
  const y = top;

  // Large horse hovering above the ground with folded legs.
  fillPixel(context, x + 23, y + 45, 94, 31, COLORS.horse);
  fillPixel(context, x + 31, y + 38, 71, 11, COLORS.horseLight);
  fillPixel(context, x + 93, y + 27, 28, 49, COLORS.horse);
  fillPixel(context, x + 111, y + 15, 38, 32, COLORS.horseLight);
  fillPixel(context, x + 137, y + 9, 13, 13, COLORS.horse);
  fillPixel(context, x + 103, y + 19, 12, 12, COLORS.horseDark);
  fillPixel(context, x + 118, y + 25, 6, 6, COLORS.ink);
  fillPixel(context, x + 143, y + 29, 9, 7, COLORS.ink);
  fillPixel(context, x + 113, y + 8, 8, 17, COLORS.horseDark);
  fillPixel(context, x + 127, y + 5, 8, 20, COLORS.horseDark);
  fillPixel(context, x + 103, y + 37, 12, 8, COLORS.horseDark);
  fillPixel(context, x + 8, y + 52, 17, 8, COLORS.horseDark);
  fillPixel(context, x + 1, y + 46, 12, 8, COLORS.horseDark);
  fillPixel(context, x + 12, y + 40, 6, 15, COLORS.horseDark);

  // Tucked legs and hooves leave a clear passage underneath.
  fillPixel(context, x + 38, y + 73, 25, 9, COLORS.horseDark);
  fillPixel(context, x + 75, y + 73, 27, 9, COLORS.horseDark);
  fillPixel(context, x + 32, y + 80, 18, 7, COLORS.ink);
  fillPixel(context, x + 91, y + 80, 18, 7, COLORS.ink);
}

function drawPixelPine(
  context: CanvasRenderingContext2D,
  x: number,
  base: number,
  height: number,
  width: number,
  color: string,
) {
  fillPixel(context, x + width / 2 - 5, base - height * .36, 10, height * .36, color);

  const tiers = [
    { top: base - height, bottom: base - height * .62, half: width * .2 },
    { top: base - height * .8, bottom: base - height * .4, half: width * .32 },
    { top: base - height * .59, bottom: base - height * .17, half: width * .43 },
    { top: base - height * .39, bottom: base, half: width * .5 },
  ];
  context.fillStyle = color;
  tiers.forEach(({ top, bottom, half }) => {
    context.beginPath();
    context.moveTo(x + width / 2, top);
    context.lineTo(x + width / 2 - half, bottom);
    context.lineTo(x + width / 2 + half, bottom);
    context.closePath();
    context.fill();
  });
}

function drawForestRow(
  context: CanvasRenderingContext2D,
  distance: number,
  speedFactor: number,
  spacing: number,
  base: number,
  heights: number[],
  widthFactor: number,
  color: string,
) {
  const cycleWidth = spacing * heights.length;
  const offset = (distance * speedFactor) % cycleWidth;
  for (
    let cycleStart = -cycleWidth - offset;
    cycleStart < WORLD_WIDTH + cycleWidth;
    cycleStart += cycleWidth
  ) {
    heights.forEach((height, index) => {
      drawPixelPine(
        context,
        cycleStart + index * spacing,
        base,
        height,
        height * widthFactor,
        color,
      );
    });
  }
}

type Star = {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
};

const STAR_FIELD: Star[] = [
  { x: 38, y: 58, size: 2, speed: 0.008, phase: 0.2 },
  { x: 104, y: 142, size: 3, speed: 0.012, phase: 1.7 },
  { x: 176, y: 86, size: 2, speed: 0.015, phase: 2.3 },
  { x: 244, y: 48, size: 2, speed: 0.006, phase: 3.4 },
  { x: 318, y: 132, size: 2, speed: 0.01, phase: 4.1 },
  { x: 392, y: 76, size: 3, speed: 0.017, phase: 1.1 },
  { x: 458, y: 174, size: 2, speed: 0.009, phase: 5.2 },
  { x: 526, y: 42, size: 2, speed: 0.013, phase: 2.8 },
  { x: 598, y: 112, size: 2, speed: 0.007, phase: 0.9 },
  { x: 666, y: 64, size: 3, speed: 0.016, phase: 4.7 },
  { x: 734, y: 154, size: 2, speed: 0.011, phase: 3.1 },
  { x: 806, y: 92, size: 2, speed: 0.006, phase: 5.7 },
  { x: 884, y: 44, size: 2, speed: 0.014, phase: 1.9 },
  { x: 932, y: 182, size: 3, speed: 0.009, phase: 0.4 },
  { x: 72, y: 224, size: 2, speed: 0.005, phase: 4.4 },
  { x: 284, y: 204, size: 2, speed: 0.012, phase: 2.1 },
  { x: 552, y: 232, size: 2, speed: 0.008, phase: 5.1 },
  { x: 844, y: 218, size: 2, speed: 0.015, phase: 3.8 },
];

function drawPixelStars(context: CanvasRenderingContext2D, time: number) {
  const cycleWidth = WORLD_WIDTH + 18;
  STAR_FIELD.forEach(({ x: baseX, y: baseY, size, speed, phase }) => {
    const x = ((baseX - time * speed) % cycleWidth + cycleWidth) % cycleWidth - 9;
    const y = baseY + Math.sin(time * 0.0012 + phase) * 2;
    const shimmer = 0.45 + (Math.sin(time * 0.002 + phase) + 1) * 0.25;

    context.save();
    context.globalAlpha = shimmer;
    fillPixel(context, x, y, size, size, COLORS.cream);
    if (size === 3) {
      fillPixel(context, x + 1, y - 3, 1, 9, COLORS.cream);
      fillPixel(context, x - 2, y + 1, 7, 1, COLORS.cream);
    }
    context.restore();
  });
}

function drawPixelForest(context: CanvasRenderingContext2D, distance: number) {
  drawForestRow(
    context,
    distance,
    .018,
    96,
    GROUND_Y - 52,
    [105, 132, 94, 121, 112, 88, 126],
    .58,
    COLORS.forestFar,
  );
  drawForestRow(
    context,
    distance,
    .038,
    122,
    GROUND_Y - 24,
    [142, 111, 157, 126, 98, 148, 118],
    .62,
    COLORS.forestMid,
  );
  drawForestRow(
    context,
    distance,
    .07,
    156,
    GROUND_Y + 2,
    [176, 145, 193, 158, 132, 184],
    .66,
    COLORS.forestNear,
  );
}

function drawGameWorld(
  context: CanvasRenderingContext2D,
  runtime: Runtime,
  time: number,
) {
  context.fillStyle = COLORS.ink;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  drawPixelStars(context, time);
  drawPixelForest(context, runtime.distance);

  context.strokeStyle = COLORS.grey;
  context.lineWidth = 3;
  context.setLineDash([18, 14]);
  context.beginPath();
  context.moveTo(0, GROUND_Y + 1);
  context.lineTo(WORLD_WIDTH, GROUND_Y + 1);
  context.stroke();
  context.setLineDash([]);

  for (let x = -runtime.groundOffset; x < WORLD_WIDTH; x += 64) {
    fillPixel(context, x, GROUND_Y + 15, 28, 3, COLORS.grey);
  }

  drawPixelSheep(
    context,
    SHEEP_X,
    runtime.sheep.bottom,
    runtime.sheep.ducking,
    time,
  );

  runtime.obstacles.forEach((obstacle) => {
    if (obstacle.kind === 'sign') {
      drawPixelSign(context, obstacle.x, GROUND_Y);
    } else {
      drawPixelHorse(context, obstacle.x, obstacle.top);
    }
  });
}

function getSheepBox(sheep: Sheep) {
  const height = sheep.ducking ? SHEEP_DUCKING_HEIGHT : SHEEP_STANDING_HEIGHT;
  return {
    left: SHEEP_X + 4,
    right: SHEEP_X + SHEEP_WIDTH - 4,
    top: sheep.bottom - height + 4,
    bottom: sheep.bottom - 2,
  };
}

function getObstacleBox(obstacle: Obstacle) {
  return {
    left: obstacle.x + 2,
    right: obstacle.x + obstacle.width - 2,
    top: obstacle.top + 2,
    bottom: obstacle.top + obstacle.height - 2,
  };
}

function boxesOverlap(
  first: ReturnType<typeof getSheepBox>,
  second: ReturnType<typeof getObstacleBox>,
) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}

function updateRuntime(runtime: Runtime, delta: number): boolean {
  runtime.score += delta * 10;
  runtime.speed = Math.min(560, 330 + runtime.score * 1.4);
  runtime.distance += runtime.speed * delta;
  runtime.groundOffset =
    (runtime.groundOffset + runtime.speed * delta) % 64;

  runtime.sheep.velocityY += 2050 * delta;
  runtime.sheep.bottom += runtime.sheep.velocityY * delta;
  if (runtime.sheep.bottom >= GROUND_Y) {
    runtime.sheep.bottom = GROUND_Y;
    runtime.sheep.velocityY = 0;
  }

  runtime.obstacleTimer -= delta;
  if (runtime.obstacleTimer <= 0) {
    const shouldSpawnHorse =
      runtime.score > 70 && runtime.horseTimer <= 0;
    if (shouldSpawnHorse) {
      runtime.obstacles.push({
        kind: 'horse',
        x: WORLD_WIDTH + 30,
        width: 160,
        top: GROUND_Y - 152,
        height: 104,
      });
      runtime.horseTimer = 2.4 + Math.random() * 1.2;
    } else {
      runtime.obstacles.push({
        kind: 'sign',
        x: WORLD_WIDTH + 30,
        width: 66,
        top: GROUND_Y - 74,
        height: 74,
      });
    }
    runtime.obstacleTimer =
      Math.max(0.7, 1.35 - runtime.score / 900) + Math.random() * 0.75;
  }
  runtime.horseTimer -= delta;

  runtime.obstacles.forEach((obstacle) => {
    obstacle.x -= runtime.speed * delta;
  });
  runtime.obstacles = runtime.obstacles.filter(
    (obstacle) => obstacle.x + obstacle.width > -20,
  );

  const sheepBox = getSheepBox(runtime.sheep);
  return runtime.obstacles.some((obstacle) =>
    boxesOverlap(sheepBox, getObstacleBox(obstacle)),
  );
}

export default function SecretSheepGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<Runtime>(createRuntime());
  const phaseRef = useRef<GamePhase>('ready');
  const gestureStartRef = useRef<{ x: number; y: number; phase: GamePhase } | null>(null);
  const duckTimeoutRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const [phase, setPhase] = useState<GamePhase>('ready');
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);

  const startGame = useCallback(() => {
    runtimeRef.current = createRuntime();
    phaseRef.current = 'playing';
    scoreRef.current = 0;
    setScore(0);
    setPhase('playing');
  }, []);

  const jump = useCallback(() => {
    const runtime = runtimeRef.current;
    if (phaseRef.current !== 'playing') return;
    if (runtime.sheep.ducking) return;
    if (runtime.sheep.bottom >= GROUND_Y - 1) {
      runtime.sheep.velocityY = -760;
    }
  }, []);

  const setDucking = useCallback((ducking: boolean) => {
    if (phaseRef.current === 'playing') {
      runtimeRef.current.sheep.ducking = ducking;
    }
  }, []);

  const duckFromGesture = useCallback(() => {
    setDucking(true);
    if (duckTimeoutRef.current !== null) {
      window.clearTimeout(duckTimeoutRef.current);
    }
    duckTimeoutRef.current = window.setTimeout(() => {
      setDucking(false);
      duckTimeoutRef.current = null;
    }, 420);
  }, [setDucking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.imageSmoothingEnabled = false;
    let animationFrame = 0;
    let lastTime = performance.now();
    let lastDisplayedScore = -1;

    const frame = (time: number) => {
      const delta = Math.min((time - lastTime) / 1000, 0.032);
      lastTime = time;
      const runtime = runtimeRef.current;

      if (phaseRef.current === 'playing') {
        const hasCollided = updateRuntime(runtime, delta);
        const nextScore = Math.floor(runtime.score);
        if (nextScore !== lastDisplayedScore) {
          lastDisplayedScore = nextScore;
          scoreRef.current = nextScore;
          setScore(nextScore);
        }
        if (hasCollided) {
          phaseRef.current = 'gameover';
          setPhase('gameover');
          setBestScore((currentBest) =>
            Math.max(currentBest, Math.floor(runtime.score)),
          );
        }
      }

      drawGameWorld(context, runtime, time);
      animationFrame = window.requestAnimationFrame(frame);
    };

    animationFrame = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => () => {
    if (duckTimeoutRef.current !== null) {
      window.clearTimeout(duckTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const jumpKey =
        event.code === 'Space' ||
        event.code === 'ArrowUp' ||
        event.code === 'KeyW';
      const duckKey =
        event.code === 'ArrowDown' || event.code === 'KeyS';

      if (jumpKey || duckKey) event.preventDefault();
      if (jumpKey && !event.repeat) {
        if (phaseRef.current === 'ready' || phaseRef.current === 'gameover') {
          startGame();
        } else {
          jump();
        }
      }
      if (duckKey) setDucking(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        event.preventDefault();
        setDucking(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [jump, setDucking, startGame]);

  const handleGamePointerDown = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    gestureStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      phase: phaseRef.current,
    };
  };

  const handleGamePointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = gestureStartRef.current;
    gestureStartRef.current = null;
    if (!start || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const isVerticalGesture =
      Math.abs(deltaY) > 24 && Math.abs(deltaY) > Math.abs(deltaX);

    if (start.phase === 'ready' || start.phase === 'gameover') {
      startGame();
      return;
    }
    if (!isVerticalGesture) {
      jump();
    } else if (deltaY < 0) {
      jump();
    } else {
      duckFromGesture();
    }
  };

  const handleRestart = () => startGame();
  const scoreLabel = String(phase === 'gameover' ? score : scoreRef.current).padStart(5, '0');

  return (
    <main
      className="secret-sheep-game"
      aria-label="Secret Sheep Run"
      onPointerDown={handleGamePointerDown}
      onPointerUp={handleGamePointerUp}
      onPointerCancel={() => {
        gestureStartRef.current = null;
      }}
    >
      <div className="secret-sheep-game__topline">
        <span>sheep / signal</span>
        <span>score {scoreLabel}</span>
      </div>
      <div className="secret-sheep-game__stage">
        <canvas
          ref={canvasRef}
          className="secret-sheep-game__canvas"
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          aria-label="Sheep Run game field"
        />
        {phase === 'ready' ? (
          <div className="secret-sheep-game__overlay">
            <span className="secret-sheep-game__eyebrow">secret signal unlocked</span>
            <h1>sheep run</h1>
            <p>jump the signs. duck the horses.</p>
            <button type="button" onClick={startGame}>
              начать игру
            </button>
          </div>
        ) : null}
        {phase === 'gameover' ? (
          <div className="secret-sheep-game__overlay">
            <span className="secret-sheep-game__eyebrow">signal interrupted</span>
            <h1>game over</h1>
            <p>
              score {String(score).padStart(5, '0')} / best{' '}
              {String(bestScore).padStart(5, '0')}
            </p>
            <button type="button" onClick={handleRestart}>
              начать заново
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}