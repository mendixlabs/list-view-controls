import { Component, ReactChild, ReactNode, createElement } from "react";

import * as classNames from "classnames";
import * as dojoAspect from "dojo/aspect";

import { Alert } from "../../Shared/components/Alert";
import { SharedUtils } from "../../Shared/SharedUtils";
import { SharedContainerUtils } from "../../Shared/SharedContainerUtils";
import { DataSourceHelper, DataSourceHelperListView } from "../../Shared/DataSourceHelper/DataSourceHelper";

import {
    getTranslations,
    hideLoadMoreButton,
    mxTranslation,
    persistListViewHeight,
    resetListViewHeight,
    setListNodeToEmpty,
    showLoadMoreButton
} from "../utils/ContainerUtils";

import { ModelerProps } from "../Pagination";
import { Pagination } from "./Pagination";
import { Validate } from "../Validate";
import { FormViewState } from "../../Shared/FormViewState";

import "../ui/Pagination.scss";

interface PaginationContainerState {
    alertMessage?: ReactChild;
    targetListView?: DataSourceHelperListView;
    validationPassed?: boolean;
    pageSize?: number;
    offset: number;
    listSize?: number;
    isPersisted?: boolean;
    loadTranslations: boolean;
}

interface PaginationPageState {
    pageSize?: number;
    offset?: number;
    isPersisted?: boolean;
}

class PaginationContainer extends Component<ModelerProps, PaginationContainerState> {
    private widgetDom: Element | null = null;
    private viewStateManager: FormViewState<PaginationPageState>;
    private retriesFind = 0;
    private initialLoading = true;
    private dataSourceHelper?: DataSourceHelper;

    constructor(props: ModelerProps) {
        super(props);

        mx.logger.debug(this.props.uniqueid, ".constructor");

        this.updateListView = this.updateListView.bind(this);
        this.translateMessageStatus = this.translateMessageStatus.bind(this);

        this.viewStateManager = new FormViewState(this.props.mxform, this.props.uniqueid, viewState => {
            if (this.state.validationPassed) {
                const datasource = this.state.targetListView!._datasource;
                viewState.pageSize = datasource.getPageSize() || this.state.pageSize;
                viewState.offset = datasource.getOffset() || this.state.offset;
                viewState.isPersisted = true;
            }
        });

        this.state = {
            alertMessage: Validate.validateProps(this.props),
            pageSize: this.viewStateManager.getPageState("pageSize", undefined), // We dont know, based on the modeler configuration of the list view.
            offset: this.viewStateManager.getPageState("offset", 0),
            isPersisted: this.viewStateManager.getPageState("isPersisted", false),
            loadTranslations: false
        };
    }

    async componentDidMount() {
        mx.logger.debug(this.props.uniqueid, ".componentDidMount");
        const isValidConfig = !!mx.session.getConfig("uiconfig.translations");
        if (!isValidConfig) {
            try {
                await getTranslations();
            } catch (e) {
                mx.logger.debug(this.props.uniqueid, ".loadingTranslations", e.message);
            }
            this.setState({ loadTranslations: true });
        }
        SharedUtils.delay(this.connectToListView.bind(this), this.checkListViewAvailable.bind(this), 20);
    }

    render() {
        mx.logger.debug(this.props.uniqueid, ".render");
        return createElement("div",
            {
                className: classNames("widget-pagination", this.props.class),
                ref: widgetDom => this.widgetDom = widgetDom,
                style: SharedUtils.parseStyle(this.props.style)
            },
            createElement(Alert, {
                className: "widget-pagination-alert"
            }, this.state.alertMessage),
            this.renderPageButton()
        );
    }

    componentWillUnmount() {
        mx.logger.debug(this.props.uniqueid, ".componentWillUnmount");
        showLoadMoreButton(this.state.targetListView);
        this.viewStateManager.destroy();
    }

    translateMessageStatus(fromValue: number, toValue: number, maxPageSize: number): string {
        return mxTranslation("mendix.lib.MxDataSource", "status", [ `${fromValue}`, `${toValue}`, `${maxPageSize}` ], this.state.loadTranslations, "{1} - {2} / {3}");
    }

    private checkListViewAvailable(): boolean {
        mx.logger.debug(this.props.uniqueid, ".checkListViewAvailable");
        if (!this.widgetDom) {
            return false;
        }
        // Added to deal with the passing this predicate in mendixLang.delay
        this.retriesFind++;
        if (this.retriesFind > 25) {
            return true; // Give-up searching
        }

        return !! SharedContainerUtils.findTargetListView(this.widgetDom.parentElement);
    }

    private renderPageButton(): ReactNode {
        mx.logger.debug(this.props.uniqueid, ".renderPageButton");

        if (this.state.validationPassed && this.state.pageSize && this.state.targetListView!._datasource.getSetSize() > 0) {
            const { offset, pageSize } = this.state;
            mx.logger.debug(this.props.uniqueid, ".renderPageButton pagesize, offset, listsize", pageSize, offset, this.state.targetListView!._datasource.getSetSize());

            return createElement(Pagination, {
                getMessageStatus: this.translateMessageStatus,
                hideUnusedPaging: this.props.hideUnusedPaging,
                items: this.props.items,
                listViewSize: this.state.targetListView!._datasource.getSetSize(),
                pageSize,
                offset,
                onChange: this.updateListView,
                pagingStyle: this.props.pagingStyle,
                pageSizeOptions: this.props.pageSizeOptions
            });
        }

        return null;
    }

    public updateListView(offSet?: number, pageSize?: number) {
        mx.logger.debug(this.props.uniqueid, ".updateListView");
        if (this.state.validationPassed) {
            this.setState({
                offset: offSet !== undefined ? offSet : this.state.offset,
                pageSize: pageSize !== undefined ? pageSize : this.state.pageSize
            });
            this.dataSourceHelper!.setPaging(offSet, pageSize);
        }
    }

    private connectToListView() {
        let alertMessage = "";
        let targetListView: DataSourceHelperListView | undefined;

        try {
            this.dataSourceHelper = DataSourceHelper.getInstance(this.widgetDom);
            targetListView = this.dataSourceHelper.getListView();
        } catch (error) {
            alertMessage = error.message;
        }

        if (targetListView) {
            DataSourceHelper.showContent(targetListView.domNode);
        }

        const validationPassed = !alertMessage;
        this.setState({
            alertMessage,
            targetListView,
            validationPassed
        });

        if (validationPassed && targetListView) {
            targetListView.__lvcPagingEnabled = true;
            hideLoadMoreButton(targetListView.domNode);
            this.beforeListViewDataRender(targetListView);
            this.afterListViewDataRender(targetListView);
            targetListView._renderData(); // render the initial listview so before and after render events apply.
        }
    }

    private beforeListViewDataRender(targetListView: DataSourceHelperListView) {
        mx.logger.debug(this.props.uniqueid, ".beforeListViewDataRender");

        dojoAspect.before(targetListView, "_renderData", () => {
            mx.logger.debug(this.props.uniqueid, "_renderData.before");

            const datasource = targetListView._datasource;
            if (datasource.getSetSize() === 0) {
                this.setState({ listSize: datasource.getSetSize() });
                return;
            } else {
                this.setState({ listSize: datasource.getSetSize() });
            }
            if (this.initialLoading) {
                this.afterListViewLoaded(targetListView);
                this.initialLoading = false;
            } else {
                if (this.state.isPersisted && this.state.pageSize !== undefined) {
                    if (targetListView._datasource.getPageSize() !== this.state.pageSize) {
                        targetListView._datasource.setPageSize(this.state.pageSize);
                    }

                    const offset = this.correctOffset(this.state.offset, targetListView._datasource.getSetSize());
                    this.setState({ offset });

                    this.setState({ isPersisted: false });
                    targetListView._renderData();
                }
                if (targetListView.__customWidgetPagingLoading) {
                    // Other pagination widget did the update, just take the new values
                    this.setState({
                        offset: datasource.getOffset(),
                        pageSize: datasource.getPageSize(),
                        listSize: datasource.getSetSize()
                    });
                } else {
                    mx.logger.debug(this.props.uniqueid, ".initialLoading False, pagingLoading False");
                    const previousOffset = this.state.offset;
                    const listSize = datasource.getSetSize();
                    let offset = previousOffset;
                    if (previousOffset !== datasource.getOffset()) {
                        if (listSize > previousOffset) {
                            this.dataSourceHelper!.setPaging(offset);
                        } else {
                            offset = 0;
                            targetListView.__customWidgetPagingOffset = offset;
                        }
                    }
                    const pageSize = datasource.getPageSize();
                    if (this.state.offset !== offset || this.state.pageSize !== pageSize || this.state.listSize !== listSize) {
                        this.setState({
                            offset,
                            pageSize,
                            listSize
                        });
                        this.dataSourceHelper!.setPaging(offset, pageSize);
                    }
                }
            }
            persistListViewHeight(targetListView.domNode);
            setListNodeToEmpty(targetListView.domNode);
        });
    }

    private afterListViewLoaded(targetListView: DataSourceHelperListView) {
        mx.logger.debug(this.props.uniqueid, ".afterListViewLoad");
        // Initial load of list view, also take in account the previous page state
        const datasource = targetListView._datasource;
        const pageSize = this.state.pageSize ? this.state.pageSize : datasource.getPageSize() && datasource.getPageSize() || 10;
        if (!this.state.pageSize) {
            // Only to initial run, page size needs to be set, when navigating back the data is coming from FormViewState
            this.setState({ pageSize });
        }
        const offset = this.correctOffset(this.state.offset, datasource.getSetSize());
        this.dataSourceHelper!.setPaging(offset, pageSize); // State is changed in here
    }

    private afterListViewDataRender(targetListView: DataSourceHelperListView) {
        mx.logger.debug(this.props.uniqueid, ".afterListViewDataRender");
        dojoAspect.after(targetListView, "_renderData", () => {
            mx.logger.debug(this.props.uniqueid, "_renderData.after");
            resetListViewHeight(targetListView.domNode as HTMLElement);
        });
    }

    private correctOffset(offset: number, listViewSize: number): number {
        return offset < listViewSize ? offset : 0;
    }

}

export default PaginationContainer;
