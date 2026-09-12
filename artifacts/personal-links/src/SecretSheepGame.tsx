import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 540;
const GROUND_Y = 420;
const SHEEP_X = 142;
const SHEEP_WIDTH = 46;
const SHEEP_STANDING_HEIGHT = 44;
const SHEEP_DUCKING_HEIGHT = 28;

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
  horse: '#d18b67',
  horseDark: '#70453d',
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
  const pixel = 4;
  const standingSprite = [
    '....WWWWWW..',
    '..WWWWWWWWWW',
    '.WWWWWWWWWWW',
    'WWWWWWWWWWWW',
    'WWWWWWWWWWDD',
    'WWWWWWWWWWDD',
    '..SSSSSS..PP',
    '..S..S...PP.',
    '.SS..S.......',
    '..S..S.......',
  ];
  const duckingSprite = [
    '...WWWWWWWW..',
    '.WWWWWWWWWWWW',
    'WWWWWWWWWWWWD',
    'WWWWWWWWWWDD.',
    '..SSSSSS..PP.',
    '.S...S...PP..',
    'S....S.......',
  ];
  const sprite = ducking ? duckingSprite : standingSprite;
  const startY = bottom - sprite.length * pixel;

  sprite.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      const color =
        cell === 'W'
          ? COLORS.white
          : cell === 'S'
            ? COLORS.shadow
            : cell === 'D'
              ? COLORS.ink
              : cell === 'P'
                ? COLORS.red
                : null;
      if (color) {
        fillPixel(
          context,
          x + columnIndex * pixel,
          startY + rowIndex * pixel,
          pixel,
          pixel,
          color,
        );
      }
    });
  });

  if (!ducking) {
    fillPixel(context, x + 8, bottom - 4, pixel, 8, COLORS.ink);
    fillPixel(context, x + 28, bottom - 4, pixel, 8, COLORS.ink);
  }
}

function drawPixelSign(context: CanvasRenderingContext2D, x: number, bottom: number) {
  const poleX = x + 18;
  fillPixel(context, poleX, bottom - 4, 5, 36, COLORS.grey);
  fillPixel(context, poleX - 3, bottom + 28, 11, 4, COLORS.grey);

  fillPixel(context, x + 3, bottom - 58, 34, 4, COLORS.red);
  fillPixel(context, x, bottom - 54, 4, 26, COLORS.red);
  fillPixel(context, x + 37, bottom - 54, 4, 26, COLORS.red);
  fillPixel(context, x + 3, bottom - 24, 34, 4, COLORS.red);
  fillPixel(context, x + 7, bottom - 50, 26, 22, COLORS.white);

  // Pixel version of the person working at a laptop.
  fillPixel(context, x + 17, bottom - 46, 6, 6, COLORS.ink);
  fillPixel(context, x + 14, bottom - 40, 12, 8, COLORS.ink);
  fillPixel(context, x + 8, bottom - 31, 22, 4, COLORS.ink);
  fillPixel(context, x + 12, bottom - 27, 4, 7, COLORS.ink);
  fillPixel(context, x + 23, bottom - 27, 4, 7, COLORS.ink);
  fillPixel(context, x + 28, bottom - 35, 5, 3, COLORS.ink);
}

function drawPixelHorse(context: CanvasRenderingContext2D, x: number, top: number) {
  const pixel = 4;
  const y = top;
  fillPixel(context, x + 12, y + 12, 42, 18, COLORS.horse);
  fillPixel(context, x + 48, y + 4, 16, 22, COLORS.horse);
  fillPixel(context, x + 60, y, 12, 12, COLORS.horse);
  fillPixel(context, x + 68, y + 4, 4, 4, COLORS.ink);
  fillPixel(context, x + 44, y + 4, 8, 8, COLORS.horseDark);
  fillPixel(context, x + 4, y + 8, 12, 8, COLORS.horseDark);
  fillPixel(context, x + 8, y + 4, 4, 12, COLORS.horseDark);
  fillPixel(context, x + 18, y + 30, pixel, 12, COLORS.horseDark);
  fillPixel(context, x + 30, y + 30, pixel, 12, COLORS.horseDark);
  fillPixel(context, x + 52, y + 26, pixel, 16, COLORS.horseDark);
  fillPixel(context, x + 64, y + 26, pixel, 16, COLORS.horseDark);
  fillPixel(context, x + 16, y + 8, 4, 4, COLORS.white);
}

function drawGameWorld(context: CanvasRenderingContext2D, runtime: Runtime) {
  context.fillStyle = COLORS.ink;
  context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

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
        width: 78,
        top: GROUND_Y - 76,
        height: 42,
      });
      runtime.horseTimer = 2.4 + Math.random() * 1.2;
    } else {
      runtime.obstacles.push({
        kind: 'sign',
        x: WORLD_WIDTH + 30,
        width: 41,
        top: GROUND_Y - 58,
        height: 58,
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

  const handleCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (phaseRef.current === 'ready' || phaseRef.current === 'gameover') {
      startGame();
    } else {
      jump();
    }
  };

  const handleRestart = () => startGame();
  const scoreLabel = String(phase === 'gameover' ? score : scoreRef.current).padStart(5, '0');

  return (
    <main className="secret-sheep-game" aria-label="Secret Sheep Run">
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
          onPointerDown={handleCanvasPointerDown}
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
      <div className="secret-sheep-game__controls">
        <button type="button" onClick={jump}>
          jump / tap
        </button>
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            setDucking(true);
          }}
          onPointerUp={() => setDucking(false)}
          onPointerCancel={() => setDucking(false)}
          onPointerLeave={() => setDucking(false)}
        >
          duck / hold
        </button>
      </div>
      <p className="secret-sheep-game__help">
        space / ↑ jump <span>·</span> ↓ duck <span>·</span> tap the field to jump
      </p>
    </main>
  );
}