/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import React, { PureComponent, Fragment } from 'react';
import PropTypes from 'prop-types';
import { debounce } from 'lodash';
import { i18n } from '@kbn/i18n';
import { injectI18n, FormattedMessage } from '@kbn/i18n/react';
import { INDEX_ILLEGAL_CHARACTERS_VISIBLE } from 'ui/indices';
import { fatalError } from 'ui/notify';

import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiDescribedFormGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiForm,
  EuiHorizontalRule,
  EuiLoadingKibana,
  EuiLoadingSpinner,
  EuiOverlayMask,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';

import { indexNameValidator, leaderIndexValidator } from '../../services/input_validation';
import routing from '../../services/routing';
import { loadIndices } from '../../services/api';
import { API_STATUS } from '../../constants';
import { SectionError } from '../section_error';
import { FormEntryRow } from '../form_entry_row';
import { advancedSettingsFields, emptyAdvancedSettings } from './advanced_settings_fields';
import { extractQueryParams } from '../../services/query_params';
import { getRemoteClusterName } from '../../services/get_remote_cluster_name';
import { RemoteClustersFormField } from '../remote_clusters_form_field';

const indexNameIllegalCharacters = INDEX_ILLEGAL_CHARACTERS_VISIBLE.join(' ');

const fieldToValidatorMap = advancedSettingsFields.reduce((map, advancedSetting) => {
  const { field, validator } = advancedSetting;
  map[field] = validator;
  return map;
}, {
  'name': indexNameValidator,
  'leaderIndex': leaderIndexValidator,
});

const getEmptyFollowerIndex = (remoteClusterName = '') => ({
  name: '',
  remoteCluster: remoteClusterName,
  leaderIndex: '',
  ...emptyAdvancedSettings,
});

/**
 * State transitions: fields update
 */
export const updateFields = (fields) => ({ followerIndex }) => ({
  followerIndex: {
    ...followerIndex,
    ...fields,
  },
});

/**
 * State transitions: errors update
 */
export const updateFormErrors = (errors) => ({ fieldsErrors }) => ({
  fieldsErrors: {
    ...fieldsErrors,
    ...errors,
  }
});

export const FollowerIndexForm = injectI18n(
  class extends PureComponent {
    static propTypes = {
      saveFollowerIndex: PropTypes.func.isRequired,
      clearApiError: PropTypes.func.isRequired,
      followerIndex: PropTypes.object,
      apiError: PropTypes.object,
      apiStatus: PropTypes.string.isRequired,
      remoteClusters: PropTypes.array,
    }

    constructor(props) {
      super(props);

      const isNew = this.props.followerIndex === undefined;
      const { route: { location: { search } } } = routing.reactRouter;
      const queryParams = extractQueryParams(search);
      const remoteClusterName = getRemoteClusterName(this.props.remoteClusters, queryParams.cluster);
      const followerIndex = isNew
        ? getEmptyFollowerIndex(remoteClusterName)
        : {
          ...getEmptyFollowerIndex(),
          ...this.props.followerIndex,
        };

      const fieldsErrors = this.getFieldsErrors(followerIndex);

      this.state = {
        isNew,
        followerIndex,
        fieldsErrors,
        areErrorsVisible: false,
        areAdvancedSettingsVisible: isNew ? false : true,
        isValidatingIndexName: false,
      };

      this.validateIndexName = debounce(this.validateIndexName, 500);
    }

    onFieldsChange = (fields) => {
      this.setState(updateFields(fields));

      const newFields = {
        ...this.state.fields,
        ...fields,
      };

      this.setState(updateFormErrors(this.getFieldsErrors(newFields)));

      if (this.props.apiError) {
        this.props.clearApiError();
      }
    };

    getFieldsErrors = (newFields) => {
      return Object.keys(newFields).reduce((errors, field) => {
        const validator = fieldToValidatorMap[field];
        const value = newFields[field];

        if (validator) {
          const error = validator(value);
          errors[field] = error;
        }

        return errors;
      }, {});
    };

    onIndexNameChange = ({ name }) => {
      this.onFieldsChange({ name });

      if (!name || !name.trim()) {
        this.setState({
          isValidatingIndexName: false,
        });

        return;
      }

      this.setState({
        isValidatingIndexName: true,
      });

      this.validateIndexName(name);
    };

    validateIndexName = async (name) => {
      try {
        const indices = await loadIndices();
        const doesExist = indices.some(index => index.name === name);
        if (doesExist) {
          const error = {
            message: (
              <FormattedMessage
                id="xpack.crossClusterReplication.followerIndexForm.indexAlreadyExistError"
                defaultMessage="An index with the same name already exists."
              />
            ),
            alwaysVisible: true,
          };

          this.setState(updateFormErrors({ name: error }));
        }

        this.setState({
          isValidatingIndexName: false,
        });
      } catch (error) {
        // Expect an error in the shape provided by Angular's $http service.
        if (error && error.data) {
          // All validation does is check for a name collision, so we can just let the user attempt
          // to save the follower index and get an error back from the API.
          this.setState({
            isValidatingIndexName: false,
          });
        }

        // This error isn't an HTTP error, so let the fatal error screen tell the user something
        // unexpected happened.
        fatalError(error, i18n.translate('xpack.crossClusterReplication.followerIndexForm.indexNameValidationFatalErrorTitle', {
          defaultMessage: 'Follower Index Forn index name validation',
        }));
      }
    };

    onClusterChange = (remoteCluster) => {
      this.onFieldsChange({ remoteCluster });
    };

    getFields = () => {
      return this.state.followerIndex;
    };

    toggleAdvancedSettings = () => {
      this.setState(({ areAdvancedSettingsVisible, cachedAdvancedSettings }) => {
        // Hide settings, clear fields, and create cache.
        if (areAdvancedSettingsVisible) {
          const fields = this.getFields();

          const newCachedAdvancedSettings = advancedSettingsFields.reduce((cache, { field }) => {
            const value = fields[field];
            if (value !== '') {
              cache[field] = value;
            }
            return cache;
          }, {});

          this.onFieldsChange(emptyAdvancedSettings);

          return {
            areAdvancedSettingsVisible: false,
            cachedAdvancedSettings: newCachedAdvancedSettings,
          };
        }

        // Show settings and restore fields from the cache.
        this.onFieldsChange(cachedAdvancedSettings);
        return {
          areAdvancedSettingsVisible: true,
          cachedAdvancedSettings: {},
        };
      });
    }

    isFormValid() {
      return Object.values(this.state.fieldsErrors).every(error => error === undefined || error === null);
    }

    sendForm = () => {
      const isFormValid = this.isFormValid();

      this.setState({ areErrorsVisible: !isFormValid });

      if (!isFormValid) {
        return;
      }

      const { name, ...followerIndex } = this.getFields();

      this.props.saveFollowerIndex(name, followerIndex);
    };

    cancelForm = () => {
      routing.navigate('/follower_indices');
    };

    /**
     * Sections Renders
     */
    renderApiErrors() {
      const { apiError, intl } = this.props;

      if (apiError) {
        const title = intl.formatMessage({
          id: 'xpack.crossClusterReplication.followerIndexForm.savingErrorTitle',
          defaultMessage: 'Error creating follower index',
        });
        const { leaderIndex } = this.state.followerIndex;
        const error = apiError.status === 404
          ? {
            data: {
              message: intl.formatMessage({
                id: 'xpack.crossClusterReplication.followerIndexForm.leaderIndexNotFoundError',
                defaultMessage: `The leader index '{leaderIndex}' you want to replicate from does not exist.`,
              }, { leaderIndex })
            }
          }
          : apiError;
        return <SectionError title={title} error={error} />;
      }

      return null;
    }

    renderForm = () => {
      const {
        followerIndex,
        isNew,
        areErrorsVisible,
        areAdvancedSettingsVisible,
        fieldsErrors,
        isValidatingIndexName,
      } = this.state;

      /**
       * Follower index name
       */

      const indexNameHelpText = (
        <Fragment>
          {isValidatingIndexName && (
            <p>
              <FormattedMessage
                id="xpack.crossClusterReplication.followerIndexForm.indexNameValidatingLabel"
                defaultMessage="Checking availability..."
              />
            </p>
          )}
          <p>
            <FormattedMessage
              id="xpack.crossClusterReplication.followerIndexForm.indexNameHelpLabel"
              defaultMessage="Spaces and the characters {characterList} are not allowed."
              values={{ characterList: <strong>{indexNameIllegalCharacters}</strong> }}
            />
          </p>
        </Fragment>
      );

      const indexNameLabel = i18n.translate(
        'xpack.crossClusterReplication.followerIndexForm.sectionFollowerIndexNameTitle', {
          defaultMessage: 'Name'
        }
      );

      const renderFollowerIndexName = () => (
        <FormEntryRow
          field="name"
          value={followerIndex.name}
          error={fieldsErrors.name}
          title={(
            <EuiTitle size="s">
              <h2>{indexNameLabel}</h2>
            </EuiTitle>
          )}
          label={indexNameLabel}
          description={i18n.translate('xpack.crossClusterReplication.followerIndexForm.sectionFollowerIndexNameDescription', {
            defaultMessage: 'A name for the follower index.'
          })}
          helpText={indexNameHelpText}
          isLoading={isValidatingIndexName}
          disabled={!isNew}
          areErrorsVisible={areErrorsVisible}
          onValueUpdate={this.onIndexNameChange}
        />
      );

      /**
       * Remote Cluster
       */
      const renderRemoteClusterField = () => {
        const { remoteClusters, currentUrl } = this.props;

        const errorMessages = {
          noClusterFound: () => (<FormattedMessage
            id="xpack.crossClusterReplication.followerIndexForm.emptyRemoteClustersCallOutDescription"
            defaultMessage="Follower indices replicate indices on remote clusters. You must add a remote cluster."
          />),
          remoteClusterNotConnectedNotEditable: () => (<FormattedMessage
            id="xpack.crossClusterReplication.followerIndexForm.currentRemoteClusterNotConnectedCallOutDescription"
            defaultMessage="You need to connect it before editing this follower index. Edit the remote cluster to
              fix the problem."
          />),
          remoteClusterDoesNotExist: () => (<FormattedMessage
            id="xpack.crossClusterReplication.followerIndexForm.currentRemoteClusterNotFoundCallOutDescription"
            defaultMessage="It might have been removed. In order to edit this follower index,
              you need to add a remote cluster with the same name."
          />)
        };

        return (
          <EuiDescribedFormGroup
            title={(
              <EuiTitle size="s">
                <h2>
                  <FormattedMessage
                    id="xpack.crossClusterReplication.followerIndexForm.sectionRemoteClusterTitle"
                    defaultMessage="Remote cluster"
                  />
                </h2>
              </EuiTitle>
            )}
            description={(
              <FormattedMessage
                id="xpack.crossClusterReplication.followerIndexForm.sectionRemoteClusterDescription"
                defaultMessage="The remote cluster to replicate your leader index from."
              />
            )}
            fullWidth
          >
            <RemoteClustersFormField
              selected={followerIndex.remoteCluster ? followerIndex.remoteCluster : null}
              remoteClusters={remoteClusters || []}
              currentUrl={currentUrl}
              isEditable={isNew}
              areErrorsVisible={areErrorsVisible}
              onChange={this.onClusterChange}
              onError={(error) => {
                this.setState(updateFormErrors({ remoteCluster: error }));
              }}
              errorMessages={errorMessages}
            />
          </EuiDescribedFormGroup>
        );
      };

      /**
       * Leader index
       */

      const leaderIndexLabel = i18n.translate(
        'xpack.crossClusterReplication.followerIndexForm.sectionLeaderIndexTitle', {
          defaultMessage: 'Leader index'
        }
      );

      const renderLeaderIndex = () => (
        <FormEntryRow
          field="leaderIndex"
          value={followerIndex.leaderIndex}
          error={fieldsErrors.leaderIndex}
          title={(
            <EuiTitle size="s">
              <h2>{leaderIndexLabel}</h2>
            </EuiTitle>
          )}
          label={leaderIndexLabel}
          description={i18n.translate('xpack.crossClusterReplication.followerIndexForm.sectionLeaderIndexDescription', {
            defaultMessage: 'The leader index you want to replicate from the remote cluster.'
          })}
          helpText={(
            <FormattedMessage
              id="xpack.crossClusterReplication.followerIndexForm.indexNameHelpLabel"
              defaultMessage="Spaces and the characters {characterList} are not allowed."
              values={{ characterList: <strong>{indexNameIllegalCharacters}</strong> }}
            />
          )}
          disabled={!isNew}
          areErrorsVisible={areErrorsVisible}
          onValueUpdate={this.onFieldsChange}
        />
      );

      /**
       * Advanced settings
       */

      const toggleAdvancedSettingButtonLabel = areAdvancedSettingsVisible
        ? (
          <FormattedMessage
            id="xpack.crossClusterReplication.followerIndex.advancedSettingsForm.hideButtonLabel"
            defaultMessage="Don't use advanced settings"
          />
        ) : (
          <FormattedMessage
            id="xpack.crossClusterReplication.followerIndex.advancedSettingsForm.showButtonLabel"
            defaultMessage="Use advanced settings"
          />
        );

      const renderAdvancedSettings = () => {
        const { isNew } = this.state;

        return (
          <Fragment>
            <EuiHorizontalRule />
            <EuiDescribedFormGroup
              title={(
                <EuiTitle size="s">
                  <h2>
                    <FormattedMessage
                      id="xpack.crossClusterReplication.followerIndexForm.advancedSettingsTitle"
                      defaultMessage="Advanced settings"
                    />
                  </h2>
                </EuiTitle>
              )}
              description={(
                <Fragment>
                  <p>
                    <FormattedMessage
                      id="xpack.crossClusterReplication.followerIndexForm.advancedSettingsDescription"
                      defaultMessage="Use advanced settings to control the rate at which data is replicated."
                    />
                  </p>
                  {isNew ? (
                    <EuiButton
                      color="primary"
                      onClick={this.toggleAdvancedSettings}
                    >
                      {toggleAdvancedSettingButtonLabel}
                    </EuiButton>
                  ) : null}
                </Fragment>
              )}
              fullWidth
            >
              <Fragment /> {/* Avoid missing `children` warning */}
            </EuiDescribedFormGroup>

            {areAdvancedSettingsVisible && (
              <Fragment>
                <EuiSpacer size="s"/>
                {advancedSettingsFields.map((advancedSetting) => {
                  const { field, title, description, label, helpText } = advancedSetting;
                  return (
                    <FormEntryRow
                      key={field}
                      field={field}
                      value={followerIndex[field]}
                      error={fieldsErrors[field]}
                      title={(
                        <EuiTitle size="xs">
                          <h3>{title}</h3>
                        </EuiTitle>
                      )}
                      description={description}
                      label={label}
                      helpText={helpText}
                      areErrorsVisible={areErrorsVisible}
                      onValueUpdate={this.onFieldsChange}
                    />
                  );
                })}
              </Fragment>
            )}
            <EuiHorizontalRule />
          </Fragment>
        );
      };

      /**
       * Form Error warning message
       */
      const renderFormErrorWarning = () => {
        const { areErrorsVisible } = this.state;
        const isFormValid = this.isFormValid();

        if (!areErrorsVisible || isFormValid) {
          return null;
        }

        return (
          <Fragment>
            <EuiSpacer size="m" />
            <EuiCallOut
              title={(
                <FormattedMessage
                  id="xpack.crossClusterReplication.followerIndexForm.validationErrorTitle"
                  defaultMessage="Fix errors before continuing."
                />
              )}
              color="danger"
              iconType="cross"
            />

            <EuiSpacer size="l" />
          </Fragment>
        );
      };

      /**
       * Form Actions
       */
      const renderActions = () => {
        const { apiStatus } = this.props;
        const { areErrorsVisible } = this.state;

        if (apiStatus === API_STATUS.SAVING) {
          return (
            <EuiFlexGroup justifyContent="flexStart" gutterSize="m">
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="l"/>
              </EuiFlexItem>

              <EuiFlexItem grow={false}>
                <EuiText>
                  <FormattedMessage
                    id="xpack.crossClusterReplication.followerIndexForm.actions.savingText"
                    defaultMessage="Saving"
                  />
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
          );
        }

        const isSaveDisabled = areErrorsVisible && !this.isFormValid();

        return (
          <EuiFlexGroup gutterSize="m" alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiButton
                color="secondary"
                iconType="check"
                onClick={this.sendForm}
                fill
                disabled={isSaveDisabled}
              >
                <FormattedMessage
                  id="xpack.crossClusterReplication.followerIndexForm.saveButtonLabel"
                  defaultMessage="Save"
                />
              </EuiButton>
            </EuiFlexItem>

            <EuiFlexItem grow={false}>
              <EuiButtonEmpty
                color="primary"
                onClick={this.cancelForm}
              >
                <FormattedMessage
                  id="xpack.crossClusterReplication.followerIndexForm.cancelButtonLabel"
                  defaultMessage="Cancel"
                />
              </EuiButtonEmpty>
            </EuiFlexItem>
          </EuiFlexGroup>
        );
      };

      return (
        <Fragment>
          <EuiForm>
            {renderFollowerIndexName()}
            {renderRemoteClusterField()}
            {renderLeaderIndex()}
            <EuiSpacer size="s" />
            {renderAdvancedSettings()}
          </EuiForm>

          {renderFormErrorWarning()}
          {renderActions()}
        </Fragment>
      );
    }

    renderLoading = () => {
      const { apiStatus } = this.props;

      if (apiStatus === API_STATUS.SAVING) {
        return (
          <EuiOverlayMask>
            <EuiLoadingKibana size="xl"/>
          </EuiOverlayMask>
        );
      }
      return null;
    }

    render() {
      return (
        <Fragment>
          {this.renderApiErrors()}
          {this.renderForm()}
          {this.renderLoading()}
        </Fragment>
      );
    }
  }
);

