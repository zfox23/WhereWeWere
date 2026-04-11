import L from 'leaflet';

declare module 'leaflet' {
    interface MapOptions {
        smoothWheelZoom?: boolean | 'center';
        smoothSensitivity?: number;
    }

    interface Map {
        smoothWheelZoom?: SmoothWheelZoom;
    }
}

type MapInternals = L.Map & {
    _stop: () => void;
    _panAnim?: { stop: () => void };
    _moveStart: (zoomChanged: boolean, noMoveStart: boolean) => void;
    _moveEnd: (zoomChanged: boolean) => void;
    _move: (center: L.LatLng, zoom: number) => void;
    _limitZoom: (zoom: number) => number;
};

class SmoothWheelZoom extends L.Handler {
    declare protected _map: L.Map;
    private _isWheeling = false;
    private _wheelMousePosition = L.point(0, 0);
    private _centerPoint = L.point(0, 0);
    private _startLatLng = L.latLng(0, 0);
    private _wheelMouseLatLng = L.latLng(0, 0);
    private _goalZoom = 0;
    private _prevCenter = L.latLng(0, 0);
    private _prevZoom = 0;
    private _zoomAnimationId = 0;
    private _timeoutId: ReturnType<typeof setTimeout> | null = null;
    private _moved = false;

    addHooks(): void {
        L.DomEvent.on(this._map.getContainer(), 'wheel', this._onWheelScroll, this);
    }

    removeHooks(): void {
        L.DomEvent.off(this._map.getContainer(), 'wheel', this._onWheelScroll, this);
    }

    private _onWheelScroll(e: Event): void {
        const wheelEvent = e as WheelEvent;
        if (!this._isWheeling) {
            this._onWheelStart(wheelEvent);
        }
        this._onWheeling(wheelEvent);
    }

    private _onWheelStart(e: WheelEvent): void {
        const map = this._map as MapInternals;

        this._isWheeling = true;
        this._wheelMousePosition = map.mouseEventToContainerPoint(e);
        this._centerPoint = map.getSize().divideBy(2);
        this._startLatLng = map.containerPointToLatLng(this._centerPoint);
        this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);
        this._moved = false;

        map._stop();
        map._panAnim?.stop();

        this._goalZoom = map.getZoom();
        this._prevCenter = map.getCenter();
        this._prevZoom = map.getZoom();

        this._zoomAnimationId = window.requestAnimationFrame(this._updateWheelZoom);
    }

    private _onWheeling(e: WheelEvent): void {
        const map = this._map as MapInternals;
        const sensitivity = map.options.smoothSensitivity ?? 1;

        this._goalZoom += L.DomEvent.getWheelDelta(e) * 0.003 * sensitivity;
        if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
            this._goalZoom = map._limitZoom(this._goalZoom);
        }

        this._wheelMousePosition = map.mouseEventToContainerPoint(e);
        this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);

        if (this._timeoutId) {
            clearTimeout(this._timeoutId);
        }
        this._timeoutId = window.setTimeout(() => this._onWheelEnd(), 200);

        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
    }

    private _onWheelEnd(): void {
        this._isWheeling = false;
        window.cancelAnimationFrame(this._zoomAnimationId);
        (this._map as MapInternals)._moveEnd(true);
    }

    private _updateWheelZoom = (): void => {
        const map = this._map as MapInternals;

        if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) {
            return;
        }

        const zoom = Math.floor((map.getZoom() + (this._goalZoom - map.getZoom()) * 0.3) * 100) / 100;
        const delta = this._wheelMousePosition.subtract(this._centerPoint);

        if (delta.x === 0 && delta.y === 0) {
            return;
        }

        const nextCenter = map.options.smoothWheelZoom === 'center'
            ? this._startLatLng
            : map.unproject(map.project(this._wheelMouseLatLng, zoom).subtract(delta), zoom);

        if (!this._moved) {
            map._moveStart(true, false);
            this._moved = true;
        }

        map._move(nextCenter, zoom);
        this._prevCenter = map.getCenter();
        this._prevZoom = map.getZoom();

        this._zoomAnimationId = window.requestAnimationFrame(this._updateWheelZoom);
    };
}

L.Map.mergeOptions({
    smoothWheelZoom: true,
    smoothSensitivity: 1,
});

L.Map.addInitHook('addHandler', 'smoothWheelZoom', SmoothWheelZoom);
