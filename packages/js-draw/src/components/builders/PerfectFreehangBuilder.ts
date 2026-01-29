import AbstractRenderer from '../../rendering/renderers/AbstractRenderer';
import RenderablePathSpec, { pathToRenderable } from '../../rendering/RenderablePathSpec';
import { Rect2, Color4, Path } from '@js-draw/math';
import Stroke from '../Stroke';
import Viewport from '../../Viewport';
import { StrokeDataPoint } from '../../types';
import { ComponentBuilder, ComponentBuilderFactory } from './types';
import RenderingStyle from '../../rendering/RenderingStyle';
import makeShapeFitAutocorrect from './autocorrect/makeShapeFitAutocorrect';
import { getStroke } from 'perfect-freehand';

/**
 * Creates a stroke builder that draws freehand lines.
 *
 * Example:
 * [[include:doc-pages/inline-examples/changing-pen-types.md]]
 */
const average = (a: number, b: number) => (a + b) / 2;

export const makePerfectFreehandLineBuilder: ComponentBuilderFactory = makeShapeFitAutocorrect(
	(initialPoint: StrokeDataPoint, viewport: Viewport) => {
		// Don't smooth if input is more than ± 3 pixels from the true curve, do smooth if
		// less than ±1 px from the curve.
		const maxSmoothingDist = viewport.getSizeOfPixelOnCanvas() * 3;
		const minSmoothingDist = viewport.getSizeOfPixelOnCanvas();

		return new PerfectFreehandLineBuilder(
			initialPoint,
			minSmoothingDist,
			maxSmoothingDist,
			viewport,
		);
	},
);

// Handles stroke smoothing and creates Strokes from user/stylus input.
export default class PerfectFreehandLineBuilder implements ComponentBuilder {
	private ended: boolean = false;
	private bbox: Rect2;
	private points: { x: number; y: number; pressure: number }[] = [];
	private averageWidth: number;

	public constructor(
		private startPoint: StrokeDataPoint,

		private minFitAllowed: number,
		maxFitAllowed: number,

		private viewport: Viewport,
	) {
		this.averageWidth = startPoint.width;
		this.bbox = new Rect2(this.startPoint.pos.x, this.startPoint.pos.y, 0, 0);
		this.points.push({ ...startPoint.pos, pressure: 0.3 });
	}

	public getBBox(): Rect2 {
		return this.bbox;
	}

	protected getRenderingStyle(): RenderingStyle {
		return {
			fill: Color4.transparent,
			stroke: this.inkTrailStyle(),
		};
	}

	public inkTrailStyle() {
		return {
			color: this.startPoint.color,
			width: this.roundDistance(this.averageWidth),
		};
	}
	protected getOutline() {
		return getStroke(
			this.points.map((p) => [p.x, p.y, p.pressure]),
			{
				simulatePressure: false,
				thinning: 1,
				size: this.startPoint.width,
				streamline: 0,
				smoothing: 0.5,
				last: this.ended,
				end: {
					cap: true,
				},
				start: {
					cap: true,
				},
			},
		);
	}
	getSvgPathFromStroke(points: number[][], closed = true) {
		const len = points.length;

		if (len < 4) {
			return ``;
		}

		let a = points[0];
		let b = points[1];
		const c = points[2];

		let prevControlX = b[0];
		let prevControlY = b[1];
		let prevEndX = average(b[0], c[0]);
		let prevEndY = average(b[1], c[1]);

		let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${prevControlX.toFixed(2)},${prevControlY.toFixed(2)} ${prevEndX.toFixed(2)},${prevEndY.toFixed(2)}`;

		// Expand SVG's shorthand 'T' commands into explicit quadratic Beziers.
		for (let i = 2, max = len - 1; i < max; i++) {
			a = points[i];
			b = points[i + 1];

			const endX = average(a[0], b[0]);
			const endY = average(a[1], b[1]);

			const controlX = 2 * prevEndX - prevControlX;
			const controlY = 2 * prevEndY - prevControlY;

			result += ` Q${controlX.toFixed(2)},${controlY.toFixed(2)} ${endX.toFixed(2)},${endY.toFixed(2)}`;

			prevControlX = controlX;
			prevControlY = controlY;
			prevEndX = endX;
			prevEndY = endY;
		}

		if (closed) {
			result += ' Z';
		}

		return result;
	}

	protected previewCurrentPath(): RenderablePathSpec | null {
		const outline = this.getOutline();

		const pathString = this.getSvgPathFromStroke(outline);
		if (!pathString) {
			return null;
		}

		const path = Path.fromString(pathString);
		return pathToRenderable(path, {
			fill: this.startPoint.color,
		});
	}

	protected previewFullPath(): RenderablePathSpec[] | null {
		const preview = this.previewCurrentPath();
		if (preview) {
			return [preview];
		}
		return null;
	}

	private previewStroke(): Stroke | null {
		const pathPreview = this.previewFullPath();

		if (pathPreview) {
			return new Stroke(pathPreview);
		}
		return null;
	}

	public preview(renderer: AbstractRenderer) {
		const paths = this.previewFullPath();
		if (paths) {
			const approxBBox = this.viewport.visibleRect;
			renderer.startObject(approxBBox);
			for (const path of paths) {
				renderer.drawPath(path);
			}
			renderer.endObject();
		}
	}

	public build(): Stroke {
		this.ended = true;
		return this.previewStroke()!;
	}

	private getMinFit(): number {
		let minFit = Math.min(this.minFitAllowed, this.averageWidth / 3);

		if (minFit < 1e-10) {
			minFit = this.minFitAllowed;
		}

		return minFit;
	}

	private roundDistance(dist: number): number {
		const minFit = this.getMinFit();
		return Viewport.roundPoint(dist, minFit);
	}

	public addPoint(newPoint: StrokeDataPoint) {
		this.points.push({ ...newPoint.pos, pressure: newPoint.width / this.startPoint.width / 2 });
		this.bbox = this.bbox.grownToPoint(newPoint.pos, newPoint.width);
		this.averageWidth = (this.averageWidth + newPoint.width) / 2;
	}
}
