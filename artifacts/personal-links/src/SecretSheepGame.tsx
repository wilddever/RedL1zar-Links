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
};

const COLORS = {
  ink: '#080808',
  white: '#f2f0df',
  cream: '#d5d0bc',
  shadow: '#817e72',
  red: '#ed554f',
  green: '#b9df57',
  grey: '#66645f',
  forestFar: '#172b32',
  forestNear: '#102126',
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
) {
  const y = bottom - (ducking ? SHEEP_DUCKING_HEIGHT : SHEEP_STANDING_HEIGHT);

  if (ducking) {
    fillPixel(context, x + 5, y + 10, 43, 19, COLORS.white);
    fillPixel(context, x + 11, y + 5, 12, 7, COLORS.white);
    fillPixel(context, x + 27, y + 4, 13, 8, COLORS.white);
    fillPixel(context, x + 42, y + 12, 17, 16, COLORS.ink);
    fillPixel(context, x + 54, y + 17, 9, 10, COLORS.ink);
    fillPixel(context, x + 40, y + 7, 9, 5, COLORS.ink);
    fillPixel(context, x + 53, y + 16, 4, 4, COLORS.white);
    fillPixel(context, x + 3, y + 27, 16, 5, COLORS.shadow);
    fillPixel(context, x + 28, y + 27, 13, 5, COLORS.shadow);
    return;
  }

  // Large wool body, dark face, ear, eye and four small legs.
  fillPixel(context, x + 6, y + 19, 43, 24, COLORS.white);
  fillPixel(context, x + 11, y + 13, 12, 9, COLORS.white);
  fillPixel(context, x + 25, y + 9, 13, 10, COLORS.white);
  fillPixel(context, x + 39, y + 14, 12, 10, COLORS.white);
  fillPixel(context, x + 47, y + 23, 16, 21, COLORS.ink);
  fillPixel(context, x + 57, y + 29, 10, 13, COLORS.ink);
  fillPixel(context, x + 45, y + 17, 9, 6, COLORS.ink);
  fillPixel(context, x + 55, y + 25, 4, 4, COLORS.white);
  fillPixel(context, x + 62, y + 37, 5, 4, COLORS.ink);
  fillPixel(context, x + 9, y + 42, 7, 16, COLORS.shadow);
  fillPixel(context, x + 24, y + 42, 7, 16, COLORS.shadow);
  fillPixel(context, x + 39, y + 42, 7, 16, COLORS.shadow);
  fillPixel(context, x + 51, y + 42, 7, 16, COLORS.shadow);
  fillPixel(context, x + 8, y + 56, 9, 3, COLORS.ink);
  fillPixel(context, x + 23, y + 56, 9, 3, COLORS.ink);
  fillPixel(context, x + 38, y + 56, 9, 3, COLORS.ink);
  fillPixel(context, x + 50, y + 56, 9, 3, COLORS.ink);
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

  // A worker with a shovel inside the roadworks triangle.
  fillPixel(context, x + 29, top + 20, 8, 8, COLORS.ink);
  fillPixel(context, x + 25, top + 28, 16, 11, COLORS.ink);
  fillPixel(context, x + 21, top + 38, 9, 5, COLORS.ink);
  fillPixel(context, x + 37, top + 38, 9, 5, COLORS.ink);
  fillPixel(context, x + 23, top + 43, 6, 12, COLORS.ink);
  fillPixel(context, x + 38, top + 43, 6, 12, COLORS.ink);
  fillPixel(context, x + 45, top + 25, 3, 31, COLORS.ink);
  fillPixel(context, x + 45, top + 53, 9, 4, COLORS.ink);
}

function drawPixelHorse(context: CanvasRenderingContext2D, x: number, top: number) {
  const y = top;
  const legTop = y + 113;

  // A large side-on horse silhouette. Its body fills the jump arc.
  fillPixel(context, x + 20, y + 62, 96, 54, COLORS.horse);
  fillPixel(context, x + 28, y + 53, 72, 13, COLORS.horseLight);
  fillPixel(context, x + 92, y + 33, 35, 62, COLORS.horse);
  fillPixel(context, x + 113, y + 19, 37, 42, COLORS.horseLight);
  fillPixel(context, x + 136, y + 12, 12, 14, COLORS.horse);
  fillPixel(context, x + 104, y + 24, 13, 12, COLORS.horseDark);
  fillPixel(context, x + 120, y + 29, 6, 6, COLORS.ink);
  fillPixel(context, x + 143, y + 34, 9, 7, COLORS.ink);
  fillPixel(context, x + 116, y + 12, 8, 18, COLORS.horseDark);
  fillPixel(context, x + 128, y + 7, 8, 22, COLORS.horseDark);
  fillPixel(context, x + 105, y + 43, 12, 8, COLORS.horseDark);
  fillPixel(context, x + 12, y + 69, 16, 8, COLORS.horseDark);
  fillPixel(context, x + 4, y + 62, 12, 8, COLORS.horseDark);
  fillPixel(context, x + 15, y + 57, 6, 16, COLORS.horseDark);
  fillPixel(context, x + 34, legTop, 10, 54, COLORS.horseDark);
  fillPixel(context, x + 61, legTop, 10, 54, COLORS.horseDark);
  fillPixel(context, x + 91, legTop - 5, 10, 59, COLORS.horseDark);
  fillPixel(context, x + 113, legTop - 5, 10, 59, COLORS.horseDark);
  fillPixel(context, x + 31, y + 164, 17, 6, COLORS.ink);
  fillPixel(context, x + 58, y + 164, 17, 6, COLORS.ink);
  fillPixel(context, x + 88, y + 159, 17, 6, COLORS.ink);
  fillPixel(context, x + 110, y + 159, 17, 6, COLORS.ink);
}

function drawPixelForest(context: CanvasRenderingContext2D, runtime: Runtime) {
  const farOffset = (runtime.groundOffset * .18) % 170;
  const nearOffset = (runtime.groundOffset * .32) % 210;

  context.fillStyle = COLORS.forestFar;
  context.fillRect(0, GROUND_Y - 116, WORLD_WIDTH, 116);
  for (let x = -170 - farOffset; x < WORLD_WIDTH + 170; x += 170) {
    context.beginPath();
    context.moveTo(x + 85, GROUND_Y - 255);
    context.lineTo(x + 8, GROUND_Y - 116);
    context.lineTo(x + 162, GROUND_Y - 116);
    context.closePath();
    context.fill();
    fillPixel(context, x + 76, GROUND_Y - 154, 18, 38, COLORS.forestFar);
  }

  context.fillStyle = COLORS.forestNear;
  context.fillRect(0, GROUND_Y - 77, WORLD_WIDTH, 77);
  for (let x = -210 - nearOffset; x < WORLD_WIDTH + 210; x += 210) {
    context.beginPath();
    context.moveTo(x + 105, GROUND_Y - 190);
    context.lineTo(x + 18, GROUND_Y - 77);
    context.lineTo(x + 192, GROUND_Y - 77);
    context.closePath();
    context.fill();
    fillPixel(context, x + 96, GROUND_Y - 112, 18, 35, COLORS.forestNear);
  }
}

function drawGameWorld(context: CanvasRenderingContext2D, runtime: Runtime) {
  context.fillStyle = COLORS.ink;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  drawPixelForest(context, runtime);

  // Sparse pixels keep the screen quiet while preserving the Chrome-game feel.
  fillPixel(context, 96, 104, 4, 4, COLORS.grey);
  fillPixel(context, 302, 82, 4, 4, COLORS.grey);
  fillPixel(context, 740, 128, 4, 4, COLORS.grey);
  fillPixel(context, 848, 72, 4, 4, COLORS.grey);

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
        top: GROUND_Y - 174,
        height: 174,
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

      drawGameWorld(context, runtime);
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